"use client"

import { useActionState, useState } from "react"
import { ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react"
import { login } from "./actions"
import { LoginBrandLockup } from "./login-brand-lockup"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import styles from "./login.module.css"

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, null)
  const [showPassword, setShowPassword] = useState(false)
  const errorId = state?.error ? "login-error" : undefined

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

        <div className={styles.brandMeta} aria-hidden="true">
          <span>Disponibilidad</span>
          <span>Reservas</span>
          <span>Cobros</span>
        </div>
      </section>

      <section className={styles.formPane} aria-labelledby="login-title">
        <header className={styles.formTopbar}>
          <span>Operon Reservas</span>
          <ThemeToggle />
        </header>

        <div className={styles.formFrame}>
          <div className={styles.formHeading}>
            <span className={styles.formEyebrow}>Acceso privado</span>
            <h1 id="login-title">Bienvenido de nuevo</h1>
            <p>Ingresá para acceder al panel de administración.</p>
          </div>

          <form action={formAction} className={styles.form}>
            <div className={styles.field}>
              <Label htmlFor="email" className={styles.fieldLabel}>
                Email
              </Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="nombre@alojamiento.com"
                autoComplete="email"
                aria-invalid={Boolean(state?.error)}
                aria-describedby={errorId}
                className={styles.input}
                required
              />
            </div>

            <div className={styles.field}>
              <Label htmlFor="password" className={styles.fieldLabel}>
                Contraseña
              </Label>
              <div className={styles.passwordField}>
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  aria-invalid={Boolean(state?.error)}
                  aria-describedby={errorId}
                  className={`${styles.input} ${styles.passwordInput}`}
                  required
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className={styles.passwordToggle}
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                </Button>
              </div>
            </div>

            {state?.error && (
              <p id="login-error" role="alert" className={styles.errorMessage}>
                {state.error}
              </p>
            )}

            <Button
              type="submit"
              size="lg"
              className={styles.submitButton}
              disabled={pending}
            >
              {pending ? (
                <>
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                  Ingresando…
                </>
              ) : (
                <>
                  Ingresar al panel
                  <ArrowRight aria-hidden="true" />
                </>
              )}
            </Button>
          </form>
        </div>
      </section>
    </main>
  )
}
