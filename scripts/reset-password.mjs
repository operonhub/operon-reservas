/**
 * Pone una contraseña nueva a una cuenta sin pasar por mail. Uso local, con
 * la clave de administrador: hasta que el dominio de Resend esté verificado,
 * es la única forma confiable de recuperar el acceso de un admin de Operon
 * (ver operon_reservas_pendientes en memoria).
 *
 * Uso: node --env-file=.env.local scripts/reset-password.mjs
 * (o `npm run reset-password`, que ya incluye el --env-file)
 *
 * El email y la contraseña se piden en ESTA terminal, nunca como argumento
 * de línea de comandos: un argv queda guardado en el historial del shell.
 */
import { createClient } from "@supabase/supabase-js"
import { createInterface } from "node:readline/promises"
import { stdin, stdout } from "node:process"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error(
    "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Corré con: node --env-file=.env.local scripts/reset-password.mjs"
  )
  process.exit(1)
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
const rl = createInterface({ input: stdin, output: stdout })

const email = (await rl.question("Email de la cuenta: ")).trim().toLowerCase()
const password = await rl.question("Contraseña nueva (mínimo 8 caracteres): ")
rl.close()

if (password.length < 8) {
  console.error("La contraseña tiene que tener al menos 8 caracteres.")
  process.exit(1)
}

// Pocos usuarios en este proyecto: alcanza con una página sin paginar.
const { data: page, error: listError } = await admin.auth.admin.listUsers()
if (listError) {
  console.error(`No se pudo listar usuarios: ${listError.message}`)
  process.exit(1)
}

const user = page.users.find((u) => u.email?.toLowerCase() === email)
if (!user) {
  console.error(`No existe ninguna cuenta con el email ${email}.`)
  process.exit(1)
}

const { error } = await admin.auth.admin.updateUserById(user.id, { password })
if (error) {
  console.error(`No se pudo actualizar: ${error.message}`)
  process.exit(1)
}

console.log(`Listo. ${email} ya puede entrar con la contraseña nueva.`)
