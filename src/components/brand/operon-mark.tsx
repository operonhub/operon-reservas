import { cn } from "@/lib/utils"

/** Isotipo Operon, tinta (#14130F) — para fondos claros. */
export function OperonMarkTinta({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 56 78"
      className={className}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="28" cy="24" r="21" fill="none" stroke="#14130F" strokeWidth="5.4" />
      <circle cx="28" cy="24" r="5.1" fill="#F2C94C" />
      <path d="M22 45 L34 45 L28 53 Z" fill="#14130F" />
      <path
        d="M28 53 C 24 61, 35 64, 30 78"
        fill="none"
        stroke="#14130F"
        strokeWidth="3.35"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Isotipo Operon, papel (#FBF9F4) — negativo para fondos oscuros. */
export function OperonMarkPapel({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 56 78"
      className={className}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="28" cy="24" r="21" fill="none" stroke="#FBF9F4" strokeWidth="5.4" />
      <circle cx="28" cy="24" r="5.1" fill="#F2C94C" />
      <path d="M22 45 L34 45 L28 53 Z" fill="#FBF9F4" />
      <path
        d="M28 53 C 24 61, 35 64, 30 78"
        fill="none"
        stroke="#FBF9F4"
        strokeWidth="3.35"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Isotipo Operon con swap automático tinta/papel según el tema. */
export function OperonMark({ className }: { className?: string }) {
  return (
    <>
      <OperonMarkTinta className={cn("dark:hidden", className)} />
      <OperonMarkPapel className={cn("hidden dark:block", className)} />
    </>
  )
}

function WordmarkSvg({
  className,
  ink,
}: {
  className?: string
  ink: string
}) {
  return (
    <svg
      viewBox="0 0 120 42"
      className={className}
      role="img"
      aria-label="Operon"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g transform="translate(0, -3) scale(0.54)">
        <circle cx="28" cy="24" r="21" fill="none" stroke={ink} strokeWidth="5.4" />
        <circle cx="28" cy="24" r="5.1" fill="#F2C94C" />
        <path d="M22 45 L34 45 L28 53 Z" fill={ink} />
        <path
          d="M28 53 C 24 61, 35 64, 30 78"
          fill="none"
          stroke={ink}
          strokeWidth="3.35"
          strokeLinecap="round"
        />
      </g>
      <text
        x="19"
        y="32"
        style={{ fontFamily: "var(--font-space-grotesk), sans-serif" }}
        fontWeight={600}
        fontSize={28}
        letterSpacing="-1.1"
        fill={ink}
      >
        peron
      </text>
    </svg>
  )
}

/** Wordmark completo: el globo funciona como la "O" de "Operon". Swap tinta/papel según el tema. */
export function OperonWordmark({ className }: { className?: string }) {
  return (
    <>
      <WordmarkSvg ink="#14130F" className={cn("dark:hidden", className)} />
      <WordmarkSvg ink="#FBF9F4" className={cn("hidden dark:block", className)} />
    </>
  )
}
