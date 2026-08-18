import styles from "./login.module.css"

/**
 * Lockup de entrada construido con la geometría oficial de Operon.
 * Las partes viven separadas para poder narrar el ascenso del globo,
 * la aparición del punto Sol y el armado final del wordmark.
 */
export function LoginBrandLockup() {
  return (
    <div className={styles.lockup}>
      <svg
        viewBox="0 0 360 124"
        className={styles.lockupSvg}
        role="img"
        aria-label="Operon"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g transform="translate(2 9) scale(1.35)">
          <g className={styles.balloonRise}>
            <circle
              cx="28"
              cy="24"
              r="21"
              fill="none"
              stroke="currentColor"
              strokeWidth="5.4"
            />
            <path d="M22 45 L34 45 L28 53 Z" fill="currentColor" />
            <path
              d="M28 53 C 24 61, 35 64, 30 78"
              fill="none"
              stroke="currentColor"
              strokeWidth="3.35"
              strokeLinecap="round"
            />
            <circle
              className={styles.dotEcho}
              cx="28"
              cy="24"
              r="7.2"
              fill="none"
              stroke="#F2C94C"
              strokeWidth="1.8"
            />
            <circle
              className={styles.sunDot}
              cx="28"
              cy="24"
              r="5.1"
              fill="#F2C94C"
            />
          </g>
        </g>

        <g className={styles.wordReveal}>
          <text
            x="65"
            y="82"
            fontFamily="var(--font-space-grotesk), sans-serif"
            fontWeight="600"
            fontSize="72"
            letterSpacing="-3.4"
            fill="currentColor"
          >
            peron
          </text>
        </g>
      </svg>

      <span className={styles.productName}>Reservas</span>
    </div>
  )
}
