# Edición mensual por zona: operación del piloto

**Estado de esta rama (no activar en producción):** cron, lector, generación estructurada
y un conector de agenda oficial de Córdoba están implementados. El conector se probó
con respuesta simulada y en lectura real de octubre 2026 (dos fechas de Oktoberfest
en Villa General Belgrano); no se generó ni publicó una edición con Gemini real.
La cobertura no es universal: sólo las zonas configuradas para esa fuente obtienen
eventos automáticamente y sólo cuando la ciudad aparece en el título oficial.
`sources.json` contiene apenas dos feriados de 2026. Antes de activar se necesitan
fuentes directas adecuadas para cada zona piloto, feriados actualizados, una clave
Gemini propia y una prueba de punta a punta. No afirmar que las noticias de todas las
ciudades se investigan automáticamente.

El nombre provisional está en `src/lib/zone-month/content.ts` (`ZONE_MONTH_LABEL`).
El enlace está al pie de la navegación operativa, separado por un borde; el mismo
sidebar se usa en escritorio y en el menú móvil. La edición presenta una pantalla
a la vez, con controles anterior/siguiente, índice y flechas izquierda/derecha.
`/tu-zona` exige el contexto de
sesión del panel. La cookie demo muestra explícitamente que no hay edición real.

Una edición por `país:ciudad normalizada` y mes, compartida entre organizaciones.
La localización procede exclusivamente de `properties.country` y `properties.city`.
No se consultan reservas, ocupación, tarifas, huéspedes, fotos, descripción, web,
contactos ni nombres del alojamiento. El worker ni siquiera recibe IDs de organizaciones.
La RPC agrupa localizaciones de propiedades activas con miembros. Si una organización
tiene varias ciudades, su panel permite elegirlas. Cambiar de localización revoca el
acceso a la anterior por RLS en la siguiente consulta. Ciudad vacía/inválida muestra
configuración; sólo owner/admin reciben enlace de corrección con los permisos existentes.
El país no tiene editor en el formulario actual: su corrección requiere soporte autorizado.

Limitación geográfica deliberada: el esquema no contiene provincia/región estructurada.
Ciudades homónimas dentro de un país comparten clave; antes de incluirlas en el piloto
hay que resolver esa ambigüedad en los datos de localización. No se infieren coordenadas,
regiones ni destinos desde direcciones o datos comerciales. Tildes distintas son zonas
 distintas; corregir la ciudad canónica mediante el editor existente.

## Fuentes y límites factuales

Estrategia del piloto: **paquetes públicos versionados y un adaptador oficial opcional**;
no se usa Google Grounding ni búsqueda del modelo. `src/lib/zone-month/sources.json` incluye dos feriados futuros de
2026 corroborados en el Instituto Nacional de Promoción Turística (organismo oficial),
con URL, publicación, fecha de consulta, período y extracto de evidencia. La página
original enlaza el calendario nacional. Se verificó el 28/09/2026:

- https://www.argentina.travel/novedades/feriados-en-argentina-2026-calendario-para-planificar-tu-viaje
- https://www.argentina.gob.ar/feriados

El recopilador filtra el paquete por país, ciudad y mes **antes** de contactar Gemini.
El paquete versionado no consulta sus enlaces: `checked` es la fecha de revisión
editorial, no una verificación automática en vivo. Para zonas expresamente listadas en
`ZONE_CORDOBA_FEED_ZONES` (claves `AR:ciudad` separadas por comas, por ejemplo
`AR:villa general belgrano`), el worker consulta la API pública
`https://cordobaturismo.gov.ar/wp-json/tribe/events/v1/events`, con intervalo del mes,
paginación acotada y timeout. Sólo acepta el evento si el título menciona exactamente
la ciudad, la fecha es válida y el enlace apunta a `/evento/` en ese mismo organismo.
Si la fuente cae, hay demasiadas páginas o el formato cambia, la edición falla en lugar
de interpretar silencio como ausencia de agenda. Si la consulta responde bien pero no
hay coincidencias, el panel informa que no hay agenda local corroborada. No infiere
eventos cercanos ni demanda. Cada nueva zona requiere evaluar una fuente pública
adecuada; no se configura una URL arbitraria desde el panel ni se leen datos privados.
Si no hay estadísticas del destino, se propone empezar a
registrar intereses agregados; nunca se afirma rendimiento de un alojamiento.

Para agregar agenda turística verificable, el operador mantiene el archivo versionado
o configura `ZONE_SOURCE_PACK_JSON` (reemplaza el paquete entero, máximo 64 KB / 100 hechos).
Debe obtener los hechos de una secretaría de turismo, municipio u organizador oficial,
comprobar fechas/alcance en el documento y transcribir sólo datos públicos. Es curaduría
de fuentes, **no aprobación de ediciones**: la generación y publicación siguen automáticas.
Agregar el hostname exacto a `ZONE_SOURCE_HOSTS`; `www.argentina.travel` y
`www.argentina.gob.ar` ya están permitidos. No aceptar paquetes enviados por huéspedes,
usuarios del panel ni contenido de propiedades. No incluir PII, URLs firmadas o secretos.

Formato (ejemplo de estructura, NO un evento publicable):

```json
{
  "version": 1,
  "facts": [{
    "id": "identificador-unico",
    "kind": "event",
    "country": "AR",
    "city": "Ciudad canónica",
    "title": "Título público corroborado",
    "start": "2026-10-10",
    "end": "2026-10-11",
    "url": "https://turismo.organismo.example/agenda/documento",
    "publisher": "Organismo público",
    "published": "2026-09-20",
    "checked": "2026-09-28",
    "validUntil": "2026-10-11",
    "evidence": "Extracto breve que respalda fecha y actividad."
  }]
}
```

`kind` admite `holiday` y `event`; feriados nacionales usan `city: null`.
Eventos requieren ciudad. Fechas ISO reales, publicación ≤ revisión ≤ hoy,
vigencia máxima de 100 días desde revisión, IDs únicos y hasta 12 hechos por edición.
URLs HTTPS sin credenciales, puerto ni query, en hosts permitidos. Actualizar fuentes
antes de cada ventana; un paquete vencido degrada a ausencia explícita de hechos,
un paquete malformado falla. No se inventan fechas para llenar espacios.
La validación sintáctica **no prueba la verdad de una fuente**: la verificación editorial
es una dependencia explícita de este MVP. Una URL permitida por sí sola no verifica un hecho.

Gemini sólo devuelve JSON con IDs de hechos y prácticas generales del catálogo: ordena
los hechos, elige una práctica comercial, una operativa y tres acciones diferentes.
No puede redactar hechos, agregar fuentes, diagnósticos particulares o ajustes de precios.
El validador exige las claves exactas, todos los IDs corroborados, enums válidos y
exactamente tres acciones priorizadas que incluyan ambas prácticas. Los textos públicos
son del catálogo versionado; no se presenta selección de IA como verificación factual.
Los cinco títulos y el cierre son constantes, no salida libre del proveedor.
Las acciones tienen esfuerzo bajo/medio (el catálogo no requiere acciones de alto esfuerzo)
y señal a medir. El orden asigna semana 1, semana 2 y semanas 3–4.

## Configuración manual y activación (no ejecutadas por este cambio)

1. Con dependencias instaladas, ejecutar tests y revisar la migración
   `supabase/migrations/0030_zone_month.sql`. Aplicarla mediante el procedimiento
   habitual del proyecto **en un entorno autorizado**. Este cambio no aplica nada remoto.
2. En el servidor, configurar `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`,
   `ZONE_GEMINI_MODEL` y un `CRON_SECRET` aleatorio largo. Nunca `NEXT_PUBLIC_` para secretos.
   No escribir claves en archivos versionados ni en el navegador.
3. Verificar localizaciones y el paquete público para el mes piloto. Configurar
   `ZONE_MONTH_ENABLED=1` sólo al activar. `DEMO_ONLY=1` impide ejecutar el worker.
4. El cron diario UTC ya está declarado en `vercel.json` en esta rama local. No se
   ejecuta hasta un despliegue autorizado y `ZONE_MONTH_ENABLED=1`:

```json
{ "crons": [{ "path": "/api/cron/zone-month", "schedule": "0 9 * * *" }] }
```

Vercel adjunta `Authorization: Bearer <CRON_SECRET>` al cron configurado. La
ruta exacta evita el middleware de sesión y exige ese secreto con comparación
constante; nunca basta una sesión de usuario.
No hay endpoint de generación para el panel, botón Generar ni aprobación.
Cron funciona en producción de Vercel, no en previews. Confirmar límites/duración del
plan antes de activar: https://vercel.com/docs/cron-jobs/manage-cron-jobs

La ventana UTC son los últimos siete días del mes anterior, con recuperación durante
los primeros siete del mes correspondiente. Fuera de ella no se encola ni llama IA.
Cada ejecución reclama hasta tres zonas secuencialmente, o dos si hay feed configurado;
la consulta al feed tiene timeout de 7 s por zona y cada llamada LLM de 12 s;
la ruta tiene `maxDuration=60`. Una fila por zona/mes, `ON CONFLICT`, bloqueo
`FOR UPDATE SKIP LOCKED`, lease único y comparación al finalizar impiden publicaciones
duplicadas o que un worker atrasado sobrescriba otro. Publicar es irreversible para las
RPC normales: otra ejecución no vuelve a generar una edición publicada.

Hasta tres intentos por zona/mes, separados por al menos 20 h. Leases interrumpidos
se marcan fallidos tras 5 min en el siguiente cron; el panel también detecta el estado
atrasado. Los fallos finales siguen visibles, sin reemplazo ficticio. Un fallo DB deja
el lease para recuperación; jamás se finge publicación. En el piloto comenzar con
**hasta cuatro zonas si hay feed**: dos trabajos diarios por siete días permiten 14
intentos previos al mes, suficientes si todas precisan tres. Sin feed, hasta siete zonas
con tres trabajos diarios (21 intentos). Más zonas requieren
revisar capacidad y costos, no simplemente aumentar el loop. Una interrupción puede
consumir cuota del proveedor aunque la publicación no se haya completado.

Revisar respuestas cron: 401 sin autorización, 200 desactivado/fuera de ventana o éxito,
503 si hubo fallos o DB no disponible. En DB se conservan estado, intentos, error tipificado,
material recopilado, modelo y edición publicada. No se guarda prosa arbitraria fallida ni
respuestas sensibles del proveedor. El archivo muestra hasta las últimas 60 ediciones de
cada zona. No hay botón de reintento ni edición por usuario; cualquier reparación excepcional
es responsabilidad del operador autorizado y no forma parte de este MVP.

## Modelo, costos y privacidad

Modelo inicial configurable: `gemini-2.5-flash-lite`, con nivel gratuito listado en la
documentación oficial consultada el 28/09/2026:
https://ai.google.dev/gemini-api/docs/pricing . Verificar vigencia, región y límites
antes de activarlo; la cuota gratuita es variable, no una garantía de costo cero.
No se habilita Google Search, Maps ni grounding. Sus términos de Grounding con Google
Search restringen el almacenamiento y reutilización de resultados en un newsletter
compartido: https://ai.google.dev/gemini-api/terms#grounding-with-google-search .
Si se habilita
facturación del proyecto Gemini, las llamadas pueden cobrarse según su plan; este código
no puede imponer desde la API una cuenta exclusivamente gratuita. Configurar cuotas y
presupuestos en la cuenta del operador. No activar búsquedas pagas sin consentimiento.

Falta de clave, 429/cuota, timeout, bloqueo del modelo, salida incompleta o inválida
producen fallo explícito, nunca publicación con texto de relleno. No se ha realizado
ninguna generación real en este trabajo. En el nivel gratuito Google puede usar entradas
y respuestas para mejorar sus productos; sólo viajan zona, mes, fuentes públicas y
catálogo general. La clave viaja en header servidor→Gemini. `server-only` protege los
módulos de generación; el cliente administrativo jamás se importa al panel cliente.

RLS requiere un membership real y una propiedad activa de esa zona, incluso para un
platform admin (no tiene excepción automática aquí). Usuarios autenticados sólo tienen
SELECT; no existen policies de escritura. Las tres RPC de worker sólo admiten service_role.
La lectura del panel usa el cliente SSR con RLS y revalida el JSON antes de renderizar.

## Verificación local

`npm test`, `npm run lint`, `npx --no-install tsc --noEmit`, `npm run build`.
Tests nuevos: `tests/lib/zone-month.test.mjs`, `tests/api/zone-month.test.mjs` y
`tests/db/zone-month.test.mjs`. PGlite aplica el esquema real; sustituye sólo el reloj
SQL de la RPC en tests para hacer reproducible la ventana, con los stubs de auth/storage
que ya tenía el proyecto. No equivale a probar infraestructura remota de Supabase/Vercel.
Los tests de API simulan Gemini y DB: no consumen cuota ni credenciales reales.
