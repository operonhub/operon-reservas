// Fuente única en src/lib/ical-url.ts (el panel y este worker comparten la
// regla). La Edge Function la importa por ruta relativa; src/ no puede
// importar con extensión .ts, así que la dirección del re-export es esta.
export {
  normalizeIcalUrl,
  type IcalUrlError,
  type IcalUrlResult,
} from "../../../src/lib/ical-url.ts"
