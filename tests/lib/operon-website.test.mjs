/**
 * La web del cliente (0038): detectar el widget, armar el código para pegar y
 * leer la página sin que el servidor llegue a la red interna.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createJiti } from "jiti"

const root = fileURLToPath(new URL("../../", import.meta.url))
const mocks = fileURLToPath(new URL("../api/mocks-zone/", import.meta.url))
const jiti = createJiti(import.meta.url, { alias: { "server-only": mocks + "empty.mjs", "@/": root + "src/" }, moduleCache: false })
const w = await jiti.import(root + "src/lib/operon/website.ts")
const f = await jiti.import(root + "src/lib/operon/safe-fetch.ts")
const template = readFileSync(root + "src/lib/widget/booking-widget.html", "utf8")

const page = (config) => `<html><body><section id="reservar"><script>(function(){ var CONFIG = { ${config} }; })()</script></section></body></html>`

test("el widget con el slug correcto está conectado, y avisa lo que conviene arreglar", () => {
  const ok = w.analyzeWidget(page(`ORG_SLUG: 'la-ponderosa', WA_NUMBER: '5493515551234', RESERVAS_APP: 'https://www.operonreservas.com'`), "la-ponderosa")
  assert.deepEqual(ok, { status: "connected", note: null })

  const old = w.analyzeWidget(page(`ORG_SLUG: "la-ponderosa", WA_NUMBER: '549XXXXXXXXXX', RESERVAS_APP: 'https://operon-reservas.vercel.app'`), "la-ponderosa")
  assert.equal(old.status, "connected")
  assert.match(old.note, /dirección vieja de Vercel/)
  assert.match(old.note, /WhatsApp/)
})

test("el error clásico: widget copiado de otro cliente o sin completar", () => {
  const other = w.analyzeWidget(page(`ORG_SLUG: 'cabanas-4-elementos', WA_NUMBER: '5493515551234'`), "la-ponderosa")
  assert.equal(other.status, "mismatch")
  assert.match(other.note, /cabanas-4-elementos/)
  assert.match(other.note, /la-ponderosa/)
  assert.equal(w.analyzeWidget(page(`ORG_SLUG: 'CAMBIAR-por-el-slug-del-cliente'`), "la-ponderosa").status, "unconfigured")
  assert.equal(w.analyzeWidget(page(`ORG_SLUG: ''`), "la-ponderosa").status, "unconfigured")
})

test("la versión demo del widget (la de las demos de prospección) se marca como tal", () => {
  const demo = `<script>var CONFIG = { WA_NUMBER: '5493885186442', SHOW_EXAMPLE_PRICES: false, UNITS: [{ name: 'Cabaña para 2' }] };</script>`
  assert.deepEqual(w.analyzeWidget(demo, "cabanas-4-elementos"), { status: "demo", note: null })
  assert.equal(w.analyzeWidget(`// CONFIG — versión DEMO (sin backend)`, "x").status, "demo")
  // Si además tiene el widget real, manda el real.
  assert.equal(w.analyzeWidget(page(`ORG_SLUG: 'x', SHOW_EXAMPLE_PRICES: false`), "x").status, "connected")
})

test("sin widget: solo un link, un iframe (el pago no anda), o nada", () => {
  assert.deepEqual(
    w.analyzeWidget(`<a href="https://www.operonreservas.com/reservar/la-ponderosa">Reservar</a>`, "la-ponderosa"),
    { status: "link_only", note: null })
  const frame = w.analyzeWidget(`<iframe src="https://www.operonreservas.com/reservar/la-ponderosa"></iframe>`, "la-ponderosa")
  assert.equal(frame.status, "link_only")
  assert.match(frame.note, /iframe/)
  // Un slug parecido no cuenta: la-ponderosa-2 no es la-ponderosa.
  assert.equal(w.analyzeWidget(`<a href="/reservar/la-ponderosa-2">x</a>`, "la-ponderosa").status, "not_found")
  assert.equal(w.analyzeWidget(`<html><body>Hola</body></html>`, "la-ponderosa").status, "not_found")
})

test("la dirección de la web se normaliza y rechaza lo que no sirve", () => {
  assert.equal(w.normalizeWebsiteUrl("sucomplejo.com.ar"), "https://sucomplejo.com.ar/")
  assert.equal(w.normalizeWebsiteUrl(" https://x.com/reservas#form "), "https://x.com/reservas")
  assert.equal(w.normalizeWebsiteUrl("http://x.com"), "http://x.com/")
  for (const bad of ["", "   ", "javascript:alert(1)", "ftp://x.com", "localhost", "https://user:pw@x.com", "https://x.com/a b", "no es una url"]) {
    assert.equal(w.normalizeWebsiteUrl(bad), null, bad)
  }
})

test("el WhatsApp se lleva al formato del widget o se deja para completar a mano", () => {
  assert.equal(w.normalizeWhatsapp("+54 9 351 555-1234"), "5493515551234")
  assert.equal(w.normalizeWhatsapp("5493515551234"), "5493515551234")
  assert.equal(w.normalizeWhatsapp("543515551234"), "5493515551234")
  assert.equal(w.normalizeWhatsapp("3515551234"), "5493515551234")
  for (const bad of [null, "", "0351 15 555 1234", "12345", "abc"]) assert.equal(w.normalizeWhatsapp(bad), null, String(bad))
})

test("el código para pegar sale de la plantilla real, con el slug y el WhatsApp del complejo", () => {
  const { code, whatsappOk } = w.buildSnippet(template, { slug: "la-ponderosa", whatsapp: "+54 9 351 555-1234" })
  assert.equal(whatsappOk, true)
  assert.match(code, /ORG_SLUG:\s+'la-ponderosa',/)
  assert.match(code, /WA_NUMBER:\s+'5493515551234',/)
  assert.doesNotMatch(code, /CAMBIAR-por/)
  // Lo que arma el panel lo reconoce el verificador como conectado.
  assert.deepEqual(w.analyzeWidget(code, "la-ponderosa"), { status: "connected", note: null })

  const noWa = w.buildSnippet(template, { slug: "la-ponderosa", whatsapp: null })
  assert.equal(noWa.whatsappOk, false)
  assert.match(noWa.code, /549XXXXXXXXXX.*completar/)
  assert.match(w.analyzeWidget(noWa.code, "la-ponderosa").note, /WhatsApp/)
  // El resto de la plantilla queda intacto.
  assert.ok(code.includes("SUPA_URL") && code.includes("RESERVAS_APP: 'https://www.operonreservas.com'"))
})

test("direcciones privadas: nunca se leen", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"]) {
    assert.equal(f.isPrivateAddress(ip), true, ip)
  }
  for (const ip of ["8.8.8.8", "172.32.0.1", "190.2.3.4", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
    assert.equal(f.isPrivateAddress(ip), false, ip)
  }
})

const html = (body, headers = {}) => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...headers } })
const redirect = (to, status = 302) => new Response(null, { status, headers: { location: to } })
const publicDns = async () => [{ address: "93.184.216.34" }]

test("lee una página pública y devuelve su HTML", async () => {
  const seen = []
  const r = await f.fetchPublicHtml("https://sucomplejo.com.ar/", { lookup: publicDns, fetch: async (url, init) => { seen.push([String(url), init.redirect]); return html("<p>hola</p>") } })
  assert.deepEqual(r, { ok: true, html: "<p>hola</p>", finalUrl: "https://sucomplejo.com.ar/" })
  assert.deepEqual(seen, [["https://sucomplejo.com.ar/", "manual"]])
})

test("no llega a la red interna: ni directo, ni por DNS, ni por redirección", async () => {
  const never = async () => { throw new Error("no debía pedirse") }
  for (const url of ["http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "https://intranet/", "http://x.internal/", "ftp://x.com/", "https://user:pw@x.com/", "https://x.com:8443/"]) {
    assert.deepEqual(await f.fetchPublicHtml(url, { lookup: publicDns, fetch: never }), { ok: false, reason: "blocked" }, url)
  }
  // Un dominio que resuelve a una IP privada (o a varias, una privada).
  assert.equal((await f.fetchPublicHtml("https://trampa.com/", { lookup: async () => [{ address: "10.0.0.5" }], fetch: never })).reason, "blocked")
  assert.equal((await f.fetchPublicHtml("https://trampa.com/", { lookup: async () => [{ address: "8.8.8.8" }, { address: "127.0.0.1" }], fetch: never })).reason, "blocked")
  assert.equal((await f.fetchPublicHtml("https://nada.com/", { lookup: async () => { throw new Error("ENOTFOUND") }, fetch: never })).reason, "blocked")
  // Redirección a la red interna: se revalida cada salto.
  const lookup = async (h) => [{ address: h === "interno.example.com" ? "192.168.0.10" : "93.184.216.34" }]
  const hop = async (url) => String(url).includes("interno") ? html("secreto") : redirect("https://interno.example.com/admin")
  assert.deepEqual(await f.fetchPublicHtml("https://sucomplejo.com.ar/", { lookup, fetch: hop }), { ok: false, reason: "blocked" })
})

test("sigue redirecciones normales, con tope, y descarta lo que no es una página", async () => {
  let n = 0
  const chain = async () => (++n < 3 ? redirect(`https://sucomplejo.com.ar/${n}`, 301) : html("fin"))
  assert.equal((await f.fetchPublicHtml("https://sucomplejo.com.ar/", { lookup: publicDns, fetch: chain })).html, "fin")
  const loop = async () => redirect("https://sucomplejo.com.ar/otra")
  assert.equal((await f.fetchPublicHtml("https://sucomplejo.com.ar/", { lookup: publicDns, fetch: loop })).reason, "too_many_redirects")
  assert.equal((await f.fetchPublicHtml("https://sucomplejo.com.ar/", { lookup: publicDns, fetch: async () => new Response("x", { headers: { "content-type": "application/pdf" } }) })).reason, "not_html")
  assert.equal((await f.fetchPublicHtml("https://sucomplejo.com.ar/", { lookup: publicDns, fetch: async () => new Response("", { status: 500 }) })).reason, "unreachable")
  assert.equal((await f.fetchPublicHtml("https://sucomplejo.com.ar/", { lookup: publicDns, fetch: async () => { throw new Error("timeout") } })).reason, "unreachable")
  assert.equal((await f.fetchPublicHtml("no es una url", { lookup: publicDns })).reason, "invalid")
})

test("una página gigante se corta en el tope y no agota la memoria", async () => {
  const big = html("a".repeat(5_000_000))
  const r = await f.fetchPublicHtml("https://sucomplejo.com.ar/", { lookup: publicDns, fetch: async () => big })
  assert.equal(r.ok, true)
  assert.equal(r.html.length, 2_000_000)
})
