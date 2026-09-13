"use server"

import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { cookies } from "next/headers"
import { DEMO_STATE_COOKIE } from "@/lib/demo/fixtures"

export async function login(_prevState: unknown, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim()
  const password = String(formData.get("password") ?? "")

  if (!email || !password) {
    return { error: "Completá email y contraseña." }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return { error: "Credenciales inválidas." }
  }

  redirect("/")
}

export async function logout() {
  const cookieStore = await cookies()
  if (cookieStore.get("operon_demo")?.value === "1") {
    cookieStore.delete("operon_demo")
    cookieStore.delete(DEMO_STATE_COOKIE) // que el próximo visitante no herede lo cargado
    redirect("/demo")
  }
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect("/login")
}
