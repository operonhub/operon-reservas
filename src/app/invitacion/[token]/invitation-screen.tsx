"use client"

import { useActionState, useState, useTransition } from "react"
import Link from "next/link"
import { ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react"
import { LoginBrandLockup } from "@/app/login/login-brand-lockup"
import styles from "@/app/login/login.module.css"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import {
  redeemForCurrentUser,
  registerWithInvitation,
  signOutAndContinue,
  type RegisterState,
} from "./actions"

export type InvitationView =
  | { kind: "invalid"; title: string; message: string }
  | { kind: "register"; email: string | null }
  | { kind: "claim"; currentEmail: string }
  | { kind: "switch"; currentEmail: string | null; isDemo: boolean }

export function InvitationScreen({ token, view }: { token: string; view: InvitationView }) {
  return (
    <main className={styles.loginShell}>
      <section className={styles.brandPane} aria-labelledby="brand-message">
        <div className={styles.brandContent}>
          <LoginBrandLockup />
          <div className={styles.brandMessage}>
            <p id="brand-message" className={styles.brandTitle}>
              Tu alojamiento,
              <br />
              <em>listo en minutos.</em>
            </p>
            <p>Creá tu cuenta, cargá tus unidades y empezá a recibir reservas.</p>
          </div>
        </div>

        <div className={styles.brandMeta} aria-hidden="true">
          <span>Tu cuenta</span>
          <span>Tus unidades</span>
          <span>Tu link</span>
        </div>
      </section>

      <section className={styles.formPane} aria-labelledby="invite-title">
        <header className={styles.formTopbar}>
          <span>Operon Reservas</span>
          <ThemeToggle />
        </header>

        <div className={styles.formFrame}>
          {view.kind === "register" && <RegisterForm token={token} lockedEmail={view.email} />}
          {view.kind === "claim" && <ClaimView token={token} currentEmail={view.currentEmail} />}
          {view.kind === "switch" && (
            <SwitchView token={token} currentEmail={view.currentEmail} isDemo={view.isDemo} />
          )}
          {view.kind === "invalid" && <InvalidView title={view.title} message={view.message} />}
        </div>
      </section>
    </main>
  )
}

function Heading({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={styles.formHeading}>
      <span className={styles.formEyebrow}>Invitación</span>
      <h1 id="invite-title">{title}</h1>
      <p>{children}</p>
    </div>
  )
}

function RegisterForm({ token, lockedEmail }: { token: string; lockedEmail: string | null }) {
  const [state, formAction, pending] = useActionState<RegisterState, FormData>(
    registerWithInvitation.bind(null, token),
    null
  )
  // Controlados: si el alta falla, lo escrito no se pierde con el reset del form.
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState(lockedEmail ?? "")
  const [showPassword, setShowPassword] = useState(false)
  const errorId = state?.error ? "invite-error" : undefined

  return (
    <>
      <Heading title="Creá tu cuenta">
        Con este email y contraseña vas a entrar a tu panel. Después configuramos tu complejo juntos.
      </Heading>

      <form action={formAction} className={styles.form}>
        <div className={styles.field}>
          <Label htmlFor="full_name" className={styles.fieldLabel}>
            Tu nombre
          </Label>
          <Input
            id="full_name"
            name="full_name"
            autoComplete="name"
            placeholder="Lucía Herrera"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className={styles.input}
            required
          />
        </div>

        <div className={styles.field}>
          <Label htmlFor="email" className={styles.fieldLabel}>
            Email
          </Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="nombre@alojamiento.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            readOnly={Boolean(lockedEmail)}
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
              autoComplete="new-password"
              minLength={8}
              aria-describedby="password-hint"
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
          <p id="password-hint" className="text-xs text-muted-foreground">
            Mínimo 8 caracteres.
          </p>
        </div>

        {state?.error && (
          <p id="invite-error" role="alert" className={styles.errorMessage}>
            {state.error}
          </p>
        )}

        <Button type="submit" size="lg" className={styles.submitButton} disabled={pending}>
          {pending ? (
            <>
              <LoaderCircle className="animate-spin" aria-hidden="true" />
              Creando tu cuenta…
            </>
          ) : (
            <>
              Crear cuenta y empezar
              <ArrowRight aria-hidden="true" />
            </>
          )}
        </Button>
      </form>
    </>
  )
}

function ClaimView({ token, currentEmail }: { token: string; currentEmail: string }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string>()

  return (
    <>
      <Heading title="Usar esta invitación">
        Vas a configurar tu complejo con la cuenta <strong>{currentEmail}</strong>.
      </Heading>

      <div className={styles.form}>
        {error && (
          <p role="alert" className={styles.errorMessage}>
            {error}
          </p>
        )}
        <Button
          size="lg"
          className={styles.submitButton}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await redeemForCurrentUser(token)
              if (result?.error) setError(result.error)
            })
          }
        >
          {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
          Continuar con esta cuenta
          <ArrowRight aria-hidden="true" />
        </Button>
        <form action={signOutAndContinue.bind(null, token)}>
          <Button type="submit" variant="ghost" className="w-full">
            Usar otra cuenta
          </Button>
        </form>
      </div>
    </>
  )
}

function SwitchView({
  token,
  currentEmail,
  isDemo,
}: {
  token: string
  currentEmail: string | null
  isDemo: boolean
}) {
  return (
    <>
      <Heading title={isDemo ? "Estás en la demo" : "Ya tenés una sesión abierta"}>
        {isDemo ? (
          "Para crear tu cuenta primero tenés que salir de la demo."
        ) : (
          <>
            Entraste como <strong>{currentEmail}</strong>, que ya tiene un complejo. Esta invitación
            es para crear una cuenta nueva.
          </>
        )}
      </Heading>

      <form action={signOutAndContinue.bind(null, token)} className={styles.form}>
        <Button type="submit" size="lg" className={styles.submitButton}>
          {isDemo ? "Salir de la demo y continuar" : "Cerrar sesión y continuar"}
          <ArrowRight aria-hidden="true" />
        </Button>
        {!isDemo && (
          <Link href="/" className={cn(buttonVariants({ variant: "ghost" }), "w-full")}>
            Ir a mi panel
          </Link>
        )}
      </form>
    </>
  )
}

function InvalidView({ title, message }: { title: string; message: string }) {
  return (
    <>
      <Heading title={title}>{message}</Heading>
      <Link
        href="/login"
        className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full")}
      >
        Ya tengo cuenta: iniciar sesión
      </Link>
    </>
  )
}
