/**
 * Dos organizaciones aisladas. La A tiene tres usuarios (owner, admin, staff)
 * para probar permisos por rol; la B uno solo. Cada una con una unidad y su
 * tarifa base.
 */
export async function seed(db) {
  const ids = {}
  const one = async (sql, params) => (await db.query(sql, params)).rows[0]

  for (const [key, slug, name] of [
    ["a", "alto-cielo", "Refugio Alto Cielo"],
    ["b", "otra-cabana", "Otra Cabaña SRL"],
  ]) {
    const org = await one("insert into organizations (name, slug) values ($1, $2) returning id", [name, slug])
    ids[`org_${key}`] = org.id
    const prop = await one(
      `insert into properties (organization_id, name, slug, currency, deposit_pct, email)
       values ($1, $2, $3, 'ARS', 50, $4) returning id`,
      [org.id, name, slug, `duenio-${key}@ejemplo.test`]
    )
    ids[`prop_${key}`] = prop.id
    const unit = await one(
      "insert into units (organization_id, property_id, name, capacity) values ($1, $2, $3, 4) returning id",
      [org.id, prop.id, `Cabaña ${key.toUpperCase()}`]
    )
    ids[`unit_${key}`] = unit.id
    await db.query(
      `insert into rates (organization_id, property_id, unit_id, kind, label, price_per_night, min_nights, is_active)
       values ($1, $2, $3, 'base', 'Tarifa base', 100000, 1, true)`,
      [org.id, prop.id, unit.id]
    )
  }

  const roles = [["owner_a", "a", "owner"], ["admin_a", "a", "admin"], ["staff_a", "a", "staff"], ["owner_b", "b", "owner"]]
  for (const [key, org, role] of roles) {
    const user = await one("insert into auth.users (email) values ($1) returning id", [`${key}@ejemplo.test`])
    ids[key] = user.id
    await db.query("insert into memberships (organization_id, user_id, role) values ($1, $2, $3)", [ids[`org_${org}`], user.id, role])
  }

  ids.ical_token = (await one("select worker_token from app_private.ical_sync_worker_config")).worker_token
  return ids
}
