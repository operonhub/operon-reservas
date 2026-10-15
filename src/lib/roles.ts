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

/**
 * Eliminar una reserva es irreversible: solo el dueño o un administrador (la
 * base lo impone en delete_reservation, migración 0046). Editar y cancelar,
 * en cambio, los hace cualquier miembro del equipo, como crear.
 */
export function canDeleteReservations(role: string): boolean {
  return canManageSettings(role)
}

export const DELETE_RESERVATION_FORBIDDEN_MESSAGE =
  "Solo el dueño o un administrador puede eliminar reservas. Si es un error o una prueba, podés cancelarla."

export const SETTINGS_READ_ONLY_MESSAGE =
  "Tu usuario puede ver esta sección, pero solo el dueño o un administrador puede cambiarla."
