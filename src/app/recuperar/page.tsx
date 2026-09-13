"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowRight, LoaderCircle, MailCheck } from "lucide-react"
import { LoginBrandLockup } from "@/app/login/login-brand-lockup"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import styles from "@/app/login/login.module.css"

/**
 * Autoservicio de "olvidé mi contraseña". El mail lo manda Supabase Auth
 * (no Resend: ese es solo para las notificaciones de reservas), así que
 * funciona aunque el dominio de Resend no esté verificado todavía.
 */
export default function RecuperarPage() {
  const [email, setEmail] = useState("")
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState(false)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    const supabase = createClient()
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/actualizar-contrasena`,
    })
    setPending(false)
    // Siempre el mismo mensaje, exista o no esa cuenta: no delata qué emails
    // están registrados.
    setSent(true)
  }

  return (
    <main className={styles.loginShell}>
      <section className={styles.brandPane} aria-labelledby="brand-message">
        <div className={styles.brandContent}>
          <LoginBrandLockup />
          <div className={styles.brandMessage}>
            <p id="brand-message" className={styles.brandTitle}>
              Tu alojamiento,
              <br />
              <em>bajo control.</em>
            </p>
            <p>Reservas, disponibilidad y cobros en un solo lugar.</p>
          </div>
        </div>
      </section>

      <section className={styles.formPane} aria-labelledby="recuperar-title">
        <header className={styles.formTopbar}>
          <span>Operon Reservas</span>
          <ThemeToggle />
        </header>

        <div className={styles.formFrame}>
          {sent ? (
            <>
              <div className={styles.formHeading}>
                <span className={styles.formEyebrow}>Revisá tu email</span>
                <h1 id="recuperar-title">Te mandamos un link</h1>
                <p>
                  Si <strong>{email.trim()}</strong> tiene una cuenta, va a recibir un mail para
                  poner una contraseña nueva. Puede tardar un par de minutos.
                </p>
              </div>
              <MailCheck className="mt-2 size-8 text-primary" aria-hidden="true" />
              <Link
                href="/login"
                className="mt-6 text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Volver a iniciar sesión
              </Link>
            </>
          ) : (
            <>
              <div className={styles.formHeading}>
                <span className={styles.formEyebrow}>Recuperar acceso</span>
                <h1 id="recuperar-title">¿Olvidaste tu contraseña?</h1>
                <p>Escribí tu email y te mandamos un link para poner una nueva.</p>
              </div>

              <form onSubmit={onSubmit} className={styles.form}>
                <div className={styles.field}>
                  <Label htmlFor="email" className={styles.fieldLabel}>
                    Email
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    autoFocus
                    placeholder="nombre@alojamiento.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={styles.input}
                    required
                  />
                </div>

                <Button type="submit" size="lg" className={styles.submitButton} disabled={pending}>
                  {pending ? (
                    <>
                      <LoaderCircle className="animate-spin" aria-hidden="true" />
                      Enviando…
                    </>
                  ) : (
                    <>
                      Mandar link
                      <ArrowRight aria-hidden="true" />
                    </>
                  )}
                </Button>
              </form>

              <Link
                href="/login"
                className="mt-4 text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Volver a iniciar sesión
              </Link>
            </>
          )}
        </div>
      </section>
    </main>
  )
}
