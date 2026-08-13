# Operon Reservas

Motor central **multi-tenant** de reservas para cabañas y alojamientos pequeños. Un solo
backend reutilizable al que se conectan las webs públicas de cada cabaña:

```
Web de la cabaña  →  API pública (Operon Reservas)  →  Base central (Supabase)  →  Panel de administración
```

Cada alojamiento es una **organización** (tenant) con sus propias unidades, tarifas,
reservas y huéspedes, totalmente aislados del resto por RLS.

> Stack: **Next.js 16** (App Router) · TypeScript · Tailwind v4 · base-ui/react · **Supabase** (Postgres, Auth, RLS).

## Puesta en marcha local

```bash
npm install
cp .env.example .env.local   # las NEXT_PUBLIC_* ya vienen completas
npm run dev                  # http://localhost:3000
```

Usuarios demo (password `Reservas2026!`):

| Email | Organización |
|---|---|
| `admin@demo-cabins.dev` | Operon Demo Cabins (Cabañas del Beagle) |
| `admin@sierra.dev` | Sierra Retreat |
| `admin@laponderosa.dev` | Cabañas La Ponderosa |

## Estructura

```
src/
  app/
    (panel)/            Panel admin (requiere sesión + membership)
      page.tsx          Inicio (resumen operativo)
      calendario/       Disponibilidad + bloqueos
      reservas/         Listado, detalle, alta manual, estados
      huespedes/        Huéspedes + historial
      unidades/         ABM de unidades
      tarifas/          ABM de tarifas
      configuracion/    Datos del alojamiento
    (public)/
      reservar/[slug]/  Web pública de reservas por organización
    login/
  components/           UI reutilizable (units, reservations, rates, availability, public…)
  lib/
    auth.ts             requireContext(): deriva la org del membership
    constants.ts        Etiquetas + máquina de estados de reservas
    supabase/           Clientes SSR/browser/middleware + tipos
supabase/migrations/    Esquema, RLS y motor de disponibilidad (0001–0005)
supabase/seed.sql       Datos demo (2 orgs)
```

## Base de datos

Proyecto Supabase propio. Migraciones versionadas en `supabase/migrations/` (orden por prefijo):

1. `0001_core_schema` — enums, tablas multi-tenant, restricción anti-doble-reserva (`EXCLUDE` sobre `unit_occupancy`).
2. `0002_rls` — RLS por organización + helpers `SECURITY DEFINER`.
3. `0003_availability_engine` — RPCs: disponibilidad pública, alta de reserva (race-safe), bloqueos y transiciones de estado.
4. `0004_harden_internal_functions` — revoca las funciones internas de `anon`/`authenticated`.
5. `0005_price_in_book` — cálculo de precio + seña dentro de `_book` (toda reserva queda tarifada).

## Conceptos clave

- **Anti-overbooking**: garantizado a nivel base de datos por una restricción `EXCLUDE` (btree_gist) sobre `unit_occupancy`. Reservas y bloqueos comparten esa tabla → nunca se solapan, ni siquiera con dos reservas simultáneas.
- **Aislamiento**: un usuario solo ve las filas de las organizaciones donde tiene `membership`. `anon` no accede a ninguna tabla; la web pública usa exclusivamente 3 RPC (`public_availability`, `public_property`, `create_public_reservation`).
- **Estados de reserva**: `inquiry → pending → pending_payment → confirmed → completed` (+ `cancelled`). Transiciones controladas en un único lugar (`_can_transition` en la base, espejado en `lib/constants.ts`).

## Deploy

Deployado en Vercel. Cargar en el proyecto las variables de `.env.example`
(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) en Settings → Environment Variables.
