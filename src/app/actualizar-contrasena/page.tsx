"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, Eye, EyeOff, LoaderCircle, TriangleAlert } from "lucide-react"
import { LoginBrandLockup } from "@/app/login/login-brand-lockup"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import styles from "@/app/login/login.module.css"

type Status = "checking" | "ready" | "invalid" | "done"

/**
 * Adonde caen los links de "olvidé mi contraseña" (propios o los que Santiago
 * manda a mano desde Supabase Studio). Supabase procesa el link y arma una
 * sesión de recuperación SOLO en el navegador (nunca llega al servidor), así
 * que esta pantalla tiene que ser pública: si el middleware la mandara antes
 * a /login, se perdería esa sesión antes de que este código pudiera leerla.
 */
export default function ActualizarContrasenaPage() {
  const router = useRouter()
  const [status, setStatus] = React.useState<Status>("checking")
  const [password, setPassword] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [showPassword, setShowPassword] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    const supabase = createClient()
    let ready = false

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        ready = true
        setStatus("ready")
      }
    })
    // El evento puede haber disparado antes de que este listener existiera:
    // si ya hay sesión cuando llegamos, alcanza con eso.
    supabase.auth.getSession().then(({ data }) => {
      if (!ready && data.session) setStatus("ready")
    })
    const timeout = setTimeout(() => {
      setStatus((current) => (current === "checking" ? "invalid" : current))
    }, 4000)

    return () => {
      sub.subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [])

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (password.length < 8) return setError("La contraseña tiene que tener al menos 8 caracteres.")
    if (password !== confirm) return setError("Las dos contraseñas no coinciden.")

    setPending(true)
    const supabase = createClient()
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
      setPending(false)
      setError("No se pudo actualizar. Pedí un link nuevo desde \"¿Olvidaste tu contraseña?\".")
      return
    }
    // Fuerza a loguearse de nuevo con la contraseña recién puesta, en vez de
    // dejar colgada la sesión temporal de recuperación.
    await supabase.auth.signOut()
    setPending(false)
    setStatus("done")
    setTimeout(() => router.push("/login"), 1500)
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

      <section className={styles.formPane} aria-labelledby="actualizar-title">
        <header className={styles.formTopbar}>
          <span>Operon Reservas</span>
          <ThemeToggle />
        </header>

        <div className={styles.formFrame}>
          {status === "checking" && (
            <div className={styles.formHeading}>
              <span className={styles.formEyebrow}>Un momento</span>
              <h1 id="actualizar-title">Revisando tu link…</h1>
            </div>
          )}

          {status === "invalid" && (
            <>
              <div className={styles.formHeading}>
                <span className={styles.formEyebrow}>Link no válido</span>
                <h1 id="actualizar-title">Este link ya se usó o venció</h1>
                <p>Pedí uno nuevo desde la pantalla de recuperación.</p>
              </div>
              <TriangleAlert className="mt-2 size-8 text-warning" aria-hidden="true" />
              <a href="/recuperar" className={cn(buttonVariants({ size: "lg" }), "mt-6 w-full")}>
                Pedir un link nuevo
              </a>
            </>
          )}

          {status === "done" && (
            <div className={styles.formHeading}>
              <span className={styles.formEyebrow}>Listo</span>
              <h1 id="actualizar-title">Contraseña actualizada</h1>
              <p>Ya podés iniciar sesión con tu contraseña nueva. Te llevamos ahí…</p>
            </div>
          )}

          {status === "ready" && (
            <>
              <div className={styles.formHeading}>
                <span className={styles.formEyebrow}>Último paso</span>
                <h1 id="actualizar-title">Elegí tu contraseña nueva</h1>
              </div>

              <form onSubmit={onSubmit} className={styles.form}>
                <div className={styles.field}>
                  <Label htmlFor="password" className={styles.fieldLabel}>
                    Contraseña nueva
                  </Label>
                  <div className={styles.passwordField}>
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      autoFocus
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={`${styles.input} ${styles.passwordInput}`}
                      required
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className={styles.passwordToggle}
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                      aria-pressed={showPassword}
                    >
                      {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                    </Button>
                  </div>
                </div>

                <div className={styles.field}>
                  <Label htmlFor="confirm" className={styles.fieldLabel}>
                    Repetila
                  </Label>
                  <Input
                    id="confirm"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    minLength={8}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className={styles.input}
                    required
                  />
                </div>

                {error && (
                  <p role="alert" className={styles.errorMessage}>
                    {error}
                  </p>
                )}

                <Button type="submit" size="lg" className={styles.submitButton} disabled={pending}>
                  {pending ? (
                    <>
                      <LoaderCircle className="animate-spin" aria-hidden="true" />
                      Guardando…
                    </>
                  ) : (
                    <>
                      Guardar contraseña
                      <ArrowRight aria-hidden="true" />
                    </>
                  )}
                </Button>
              </form>
            </>
          )}
        </div>
      </section>
    </main>
  )
}
