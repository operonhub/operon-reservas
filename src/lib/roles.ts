/**
 * Tarifas, unidades, configuración y Mercado Pago son del owner o un admin;
 * 'staff' los ve pero no los cambia. La base lo impone por RLS (0025): esto
 * es para no ofrecer en la interfaz lo que después va a rechazar, y para
 * devolver un mensaje claro en vez del error crudo de la policy.
 *
 * Sin imports de servidor: lo usan también componentes de cliente.
 */
export function canManageSettings(role: string): boolean {
  return role === "owner" || role === "admin"
}

export const SETTINGS_READ_ONLY_MESSAGE =
  "Tu usuario puede ver esta sección, pero solo el dueño o un administrador puede cambiarla."
