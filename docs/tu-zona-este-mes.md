# Tu zona este mes

## Versión 2 (migración 0037, 30/09/2026) — la vigente

La v1 (Gemini eligiendo entre 7 consejos fijos, con 3 datos cargados a mano) no le servía al dueño.
La v2 investiga el destino de verdad y lo cruza con el complejo:

- **Investigación (compartida por zona):** `src/lib/zone-month/research.ts`, Claude Sonnet 5.5
  (`ZONE_MODEL` para cambiarlo) con `ANTHROPIC_API_KEY`. Dos pasos:
  1. *Investigar*: búsqueda web básica (`web_search_20250305`, máx. 8 búsquedas, localizada en la
     ciudad/provincia) y un dossier. La API pega a cada frase las citas reales de la búsqueda; las
     convertimos en marcadores `[n]` y armamos nosotros la lista de fuentes.
  2. *Ordenar*: otra llamada, sin herramientas y con JSON estricto, pasa el dossier al formato del
     informe. Solo puede citar números de esa lista: **ningún link sale del modelo**.
  Se usa búsqueda *básica* (sin filtrado dinámico) porque es la que garantiza citas en el texto,
  y JSON estricto e citas no se pueden pedir en la misma llamada.
- **Qué viaja al modelo:** localidad, departamento y provincia (0036), mes, feriados curados de
  `sources.json` / feed de Córdoba y la cuenta agregada de intereses de la zona. Nunca datos de
  alojamientos, huéspedes ni nombres.
- **Formato v2** (`src/lib/zone-month/edition-v2.ts`): panorama, agenda (con "para tu
  alojamiento"), calendario (feriados, findes largos, vacaciones), info práctica, ideas y mensajes
  listos con `{alojamiento}`/`{link}`, fuentes. `normalizeEditionV2` descarta datos sin fuente o con
  fechas fuera del mes (±7 días) y recorta textos; `validateEditionV2` es estricta y se aplica antes
  de publicar y al leer. Si del pueblo hay poco, amplía a departamento/provincia (`place.scope`).
- **Tu complejo en {mes}** (`src/lib/zone-month/your-property.ts`): sin IA, al abrir la página y
  con RLS + filtro por organización. Ocupación del mes, reservas sin seña y, por fecha clave,
  unidades libres y precio por noche (`simulate_price`) contra un martes normal; si cobra lo mismo,
  ofrece crear una tarifa "Temporada" con las fechas precargadas.
- **Respuestas del dueño** (`zone_month_feedback`): intereses para la próxima edición y tildes de
  "hecho" en las ideas. `zone_month_interests` le da al worker solo la cuenta por tema de la zona.
- **Cuándo:** igual que antes, últimos cinco días del mes para el siguiente (cron diario). Hasta 4
  pueblos por corrida en paralelo (`JOBS_PER_RUN`), `maxDuration = 300` en el cron y en la ficha de
  `/operon`. Desde `/operon` se puede **volver a generar** una edición publicada (deja de verse
  hasta que sale la nueva).
- **Costo real:** el material guardado (`zone_month_editions.material`) incluye el dossier y
  `usage` (tokens y búsquedas) de cada edición, para medirlo.
- Las ediciones v1 publicadas se siguen mostrando con su diseño.

Lo que sigue documenta la v1 y la operación general (ventana, reintentos, RLS), que no cambió.

## Versión 1 (histórico)


**Estado de esta rama (no activar en producción):** cron, lector, generación estructurada
y un conector de agenda oficial de Córdoba están implementados. El conector se probó
con respuesta simulada y en lectura real de octubre 2026 (dos fechas de Oktoberfest
en Villa General Belgrano). El 28/09/2026 se publicó una edición real para
AR:villa ventana, octubre de 2026, usando Gemini real y una Supabase local
para el piloto de Cabañas La Ponderosa. El servidor y la base usaron 127.0.0.1;
no hubo despliegue ni conexión a la Supabase alojada.
La cobertura no es universal: sólo las zonas configuradas para esa fuente obtienen
eventos automáticamente y sólo cuando la ciudad aparece en el título oficial.
`sources.json` contiene dos feriados de 2026 y un evento oficial de Huacalera.
Antes de activar fuera del piloto se necesitan fuentes directas para cada zona, feriados actualizados,
una clave Gemini propia y validación completa del entorno de destino. No afirmar
que las noticias de todas las ciudades se investigan automáticamente.

El nombre provisional está en `src/lib/zone-month/content.ts` (`ZONE_MONTH_LABEL`).
El enlace está al pie de la navegación operativa, separado por un borde; el mismo
sidebar se usa en escritorio y en el menú móvil. La edición presenta una pantalla
a la vez, con controles anterior/siguiente, índice y flechas izquierda/derecha.
El botón Modo presentación abre la edición a pantalla completa, con salida visible,
Escape, navegación por teclado y desplazamiento interno para diapositivas largas.
Cada capítulo tiene tratamiento visual propio y usa los colores del panel.
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
no se usa Google Grounding ni búsqueda del modelo. `src/lib/zone-month/sources.json`
incluye dos feriados futuros de 2026 corroborados en el Instituto Nacional de
Promoción Turística (organismo oficial)
y el Desafío TTT de Huacalera del 3 y 4 de octubre, publicado por el Gobierno de Jujuy,
con URL, publicación, fecha de consulta, período y extracto de evidencia. La página
original enlaza el calendario nacional. Se verificó el 28/09/2026:

- https://www.argentina.travel/novedades/feriados-en-argentina-2026-calendario-para-planificar-tu-viaje
- https://www.argentina.gob.ar/feriados
- https://prensa.jujuy.gob.ar/huacalera/huacalera-se-prepara-recibir-una-nueva-fecha-del-desafio-ttt-el-primer-kilometro-vertical-n125304

Para los dos clientes propuestos, las páginas públicas ubican Tierra Adentro en
Purmamarca (`AR:purmamarca`) y Cuatro Elementos en Huacalera (`AR:huacalera`).
Referencias: https://tierra-adentro-purmamarca.netlify.app/ y
https://cuatro-elementos-psi.vercel.app/ .
La edición de octubre de Huacalera incluye el evento anterior y el feriado nacional.
La de Purmamarca incluye el feriado y declara que no hay agenda local corroborada
en el paquete. La agenda turística provincial estaba temporalmente no disponible
al revisarla el 28/09/2026; no se importaron eventos de otras localidades.
Antes de activar, confirmar que cada alojamiento tenga una propiedad activa con
esa ciudad y un miembro real en su organización de Operon Reservas.

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
Agregar el hostname exacto a `ZONE_SOURCE_HOSTS`; `www.argentina.travel`,
`www.argentina.gob.ar` y `prensa.jujuy.gob.ar` ya están permitidos. No aceptar
paquetes enviados por huéspedes,
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

## Configuración manual y activación fuera del piloto local (pendientes)

1. Con dependencias instaladas, ejecutar tests y revisar la migración
   `supabase/migrations/0030_zone_month.sql`. Aplicarla mediante el procedimiento
   habitual del proyecto **en un entorno autorizado**. Este cambio no aplica nada remoto.
2. En el servidor, configurar `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`,
   `ZONE_GEMINI_MODEL` y un `CRON_SECRET` aleatorio largo. Nunca `NEXT_PUBLIC_` para secretos.
   No escribir claves en archivos versionados ni en el navegador.
3. Verificar localizaciones y el paquete público para el mes piloto. Desde la
   migración 0034 no hay lista de zonas en el entorno: cada cliente se activa desde
   su ficha en `/operon/clientes/<id>` ("Tu zona este mes" → Activar). Las zonas que
   se generan son las ciudades de los clientes activados, no suspendidos y con
   equipo, con un tope de 10 (`operon_set_zone_month` rechaza con `ZONE_CAP`).
   Configurar `ZONE_MONTH_ENABLED=1` sólo al activar: es el interruptor general del
   cron, de la página y del link del menú. `DEMO_ONLY=1` impide ejecutar el worker.
4. El cron diario UTC ya está declarado en `vercel.json` en esta rama local. No se
   ejecuta hasta un despliegue autorizado y `ZONE_MONTH_ENABLED=1`:

```json
{ "crons": [{ "path": "/api/cron/zone-month", "schedule": "0 9 * * *" }] }
```

Vercel adjunta `Authorization: Bearer <CRON_SECRET>` al cron configurado. La
ruta exacta evita el middleware de sesión y exige ese secreto con comparación
constante; nunca basta una sesión de usuario.
Desde la ficha del cliente en `/operon`, "Generar ahora" / "Reintentar" deja la
edición pendiente con `operon_zone_month_queue` (registrado en Actividad; a una
edición fallida le da un intento más, sin superar tres) y, con `ZONE_MONTH_ENABLED=1`,
la genera en el momento con `runZoneMonthEdition`, fuera de la ventana de cinco días.
Sólo el mes actual o el próximo. No hay aprobación manual del contenido.
Cron funciona en producción de Vercel, no en previews. Confirmar límites/duración del
plan antes de activar: https://vercel.com/docs/cron-jobs/manage-cron-jobs

La ventana UTC son los últimos cinco días calendario del mes anterior. La edición
del mes siguiente debe quedar visible antes de que empiece ese mes. Fuera de la
ventana no se encola ni llama IA; los leases vencidos se marcan fallidos incluso
después del cierre. Cada ejecución reclama hasta dos zonas secuencialmente, o una
si hay feed configurado y el timeout de Gemini supera 18 s;
la consulta al feed tiene timeout de 7 s por zona y cada llamada LLM de 25 s
por defecto (configurable mediante ZONE_GEMINI_TIMEOUT_MS, máximo 25 s);
la ruta tiene `maxDuration=60`. Una fila por zona/mes, `ON CONFLICT`, bloqueo
`FOR UPDATE SKIP LOCKED`, lease único y comparación al finalizar impiden publicaciones
duplicadas o que un worker atrasado sobrescriba otro. Publicar es irreversible para las
RPC normales: otra ejecución no vuelve a generar una edición publicada.

Hasta tres intentos por zona/mes, separados por al menos 20 h y sólo dentro de
la ventana de cinco días. Leases interrumpidos se marcan fallidos tras 5 min en
el siguiente cron; el panel también detecta el estado
atrasado. Los fallos finales siguen visibles, sin reemplazo ficticio. Un fallo DB deja
el lease para recuperación; jamás se finge publicación. Con un cron diario y sin
feed, dos trabajos por día dan diez oportunidades en cinco días: suficientes para
dos zonas con hasta tres intentos cada una si el piloto se activa el primer día de
la ventana. Con feed y timeout de 25 s se procesa sólo una zona por día, lo que
no garantiza tres intentos para dos zonas; revisar capacidad antes de activarlas.
Una interrupción puede consumir cuota del proveedor aunque la publicación no
se haya completado.

Revisar respuestas cron: 401 sin autorización, 200 desactivado/fuera de ventana o éxito,
503 si hubo fallos o DB no disponible. En DB se conservan estado, intentos, error tipificado,
material recopilado, modelo y edición publicada. No se guarda prosa arbitraria fallida ni
respuestas sensibles del proveedor. El archivo muestra hasta las últimas 60 ediciones de
cada zona. No hay botón de reintento ni edición por usuario; cualquier reparación excepcional
es responsabilidad del operador autorizado y no forma parte de este MVP.

## Modelo, costos y privacidad

Modelo predeterminado configurable: `gemini-3.5-flash-lite`, el usado en la
edición local publicada. Google recomienda 3.5 Flash-Lite para proyectos nuevos;
el nivel gratuito figura en la documentación oficial consultada el 28/09/2026:
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
producen fallo explícito, nunca publicación con texto de relleno. La edición de
Villa Ventana se generó con Gemini real el 28/09/2026 en el entorno local; otra
zona piloto terminó con fallo de timeout tras tres intentos. En el nivel gratuito
Google puede usar entradas y respuestas para mejorar sus productos; sólo viajan
zona, mes, fuentes públicas y catálogo general. La clave viaja en header
servidor→Gemini. `server-only` protege los
módulos de generación; el cliente administrativo jamás se importa al panel cliente.

RLS requiere un membership real y una propiedad activa de esa zona, incluso para un
platform admin (no tiene excepción automática aquí). Usuarios autenticados sólo tienen
SELECT; no existen policies de escritura. Las tres RPC de worker sólo admiten service_role.
La lectura del panel usa el cliente SSR con RLS y revalida el JSON antes de renderizar.

## Verificación local

En el piloto aislado se confirmó la edición publicada de octubre de 2026 para
AR:villa ventana, visible con la cuenta local de Cabañas La Ponderosa. La segunda
cuenta local sólo puede leer AR:los reartes. Tras los reintentos permanece una sola
fila por zona y mes. Un hostname de fuente no autorizado se rechazó; los fallos
reales del proveedor quedaron visibles sin publicar texto alternativo. Se revisaron
manualmente las vistas de escritorio y móvil, incluida la presentación a pantalla
completa, navegación y desplazamiento. El 28/09/2026 pasaron `npm test` (117 tests),
`npm run lint`, `npx --no-install tsc --noEmit` y `npm run build` con variables
de la Supabase local. Las migraciones 0031 y 0032 se aplicaron sólo allí. La
RPC local con la lista Purmamarca/Huacalera no encontró trabajo: ninguna de esas
ciudades tiene todavía una propiedad activa en la base de prueba. No se generó
una edición real con Gemini para esas dos zonas ni se probó producción.

Tests nuevos: `tests/lib/zone-month.test.mjs`, `tests/api/zone-month.test.mjs` y
`tests/db/zone-month.test.mjs`. PGlite aplica el esquema real; sustituye sólo el reloj
SQL de la RPC en tests para hacer reproducible la ventana, con los stubs de auth/storage
que ya tenía el proyecto. No equivale a probar infraestructura remota de Supabase/Vercel.
Los tests de API simulan Gemini y DB: no consumen cuota ni credenciales reales.
