/**
 * Levanta el esquema REAL (todas las migraciones de supabase/migrations) en
 * PGlite: Postgres compilado a WASM, en memoria. Sin Docker, sin red, sin
 * tocar ninguna base remota.
 *
 * Lo que Supabase tiene y PGlite no, se simula acá, y solo acá, para que
 * nadie confunda un stub con el comportamiento real:
 *   - roles anon / authenticated / service_role;
 *   - auth.uid() y auth.role(), que leen una GUC en vez del JWT;
 *   - request.headers, para simular la IP que Cloudflare pone en cf-connecting-ip;
 *   - el schema storage (buckets, objects, foldername) con RLS, como Supabase;
 *   - pg_net y pg_cron no existen: se quitan sus `create extension`, los
 *     bloques que programan cron y las llamadas net.http_post.
 */
import { readFileSync, readdirSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto"

const MIGRATIONS_DIR = new URL("../../supabase/migrations/", import.meta.url)

export const MIGRATIONS = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()

function stripSupabaseOnly(sql) {
  return sql
    .replace(/create extension if not exists (pg_net|pg_cron);/gi, "")
    .replace(/do \$\$\s*declare\s+v_job_id bigint;[\s\S]*?\$\$;/gi, "")
    .replace(/select net\.http_post\([\s\S]*?\) into v_request_id;/gi, "v_request_id := 0;")
}

const SUPABASE_STUBS = `
  create role anon;
  create role authenticated;
  create role service_role;
  create schema if not exists app_private;
  create schema if not exists auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb default '{}'::jsonb
  );
  create or replace function auth.uid() returns uuid language sql stable as $fn$
    select nullif(current_setting('test.uid', true), '')::uuid
  $fn$;
  create or replace function auth.role() returns text language sql stable as $fn$
    select coalesce(nullif(current_setting('test.role', true), ''), 'anon')
  $fn$;

  create schema if not exists storage;
  create table storage.buckets (
    id text primary key, name text, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets(id), name text, owner uuid
  );
  alter table storage.objects enable row level security;
  -- Igual que Supabase: los segmentos de carpeta, sin el nombre del archivo.
  create or replace function storage.foldername(name text) returns text[] language plpgsql as $fn$
  declare _parts text[];
  begin
    select string_to_array(name, '/') into _parts;
    return _parts[1:array_length(_parts, 1) - 1];
  end $fn$;
`

// Supabase concede todo sobre public a estos roles; RLS es la única puerta.
// PGlite no lo hace solo: sin esto, un test de RLS mediría la falta de GRANT.
const SUPABASE_GRANTS = `
  grant usage on schema public, storage to anon, authenticated, service_role;
  grant all on all tables in schema public, storage to anon, authenticated, service_role;
  grant all on all sequences in schema public to anon, authenticated, service_role;
`

export async function createDb() {
  const db = await PGlite.create({ extensions: { btree_gist, pgcrypto } })
  await db.exec(SUPABASE_STUBS)
  for (const file of MIGRATIONS) {
    const sql = readFileSync(new URL(file, MIGRATIONS_DIR), "utf8")
    try {
      await db.exec(stripSupabaseOnly(sql))
    } catch (error) {
      throw new Error(`La migración ${file} falló en PGlite: ${error.message}`)
    }
  }
  await db.exec(SUPABASE_GRANTS)
  return db
}

/**
 * Lo que siga corre como un rol de Supabase, con un auth.uid() dado y, si se
 * pasa, la IP del cliente tal como la deja Cloudflare en request.headers.
 */
export async function as(db, role, { uid = "", ip = "" } = {}) {
  await db.exec("reset role;")
  const headers = ip ? JSON.stringify({ "cf-connecting-ip": ip }) : ""
  await db.query(
    "select set_config('test.uid', $1, false), set_config('test.role', $2, false), set_config('request.headers', $3, false)",
    [uid, role, headers]
  )
  if (role !== "postgres") await db.exec(`set role ${role};`)
}

/** Ejecuta y devuelve { rows }, o { error } sin lanzar. */
export async function attempt(db, sql, params) {
  try {
    return { rows: (await db.query(sql, params)).rows }
  } catch (error) {
    return { error: String(error.message).split("\n")[0] }
  }
}
