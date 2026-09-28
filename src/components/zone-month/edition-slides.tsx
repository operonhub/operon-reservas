"use client"

import { useEffect, useState } from "react"
import { CLOSING, PRACTICES, TITLES, type Edition } from "@/lib/zone-month/content"

export function EditionSlides({ edition }: { edition: Edition }) {
  const [active, setActive] = useState(0)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      if (event.key === "ArrowRight") setActive(current => Math.min(current + 1, TITLES.length - 1))
      if (event.key === "ArrowLeft") setActive(current => Math.max(current - 1, 0))
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])
  const { material, selection } = edition
  const commercial = PRACTICES[selection.commercial]
  const operational = PRACTICES[selection.operational]
  const facts = selection.factIds.map(id => material.facts.find(f => f.id === id)!)
  const slideClass = "scroll-mt-6 rounded-2xl border bg-card p-5 sm:p-8 lg:min-h-80 lg:p-10"
  const heading = (index: number) => <header className="mb-6 flex items-start gap-4"><span className="text-3xl font-light text-muted-foreground">0{index + 1}</span><h2 className="max-w-xl text-lg font-semibold tracking-tight sm:text-2xl">{TITLES[index]}</h2></header>
  return <>
    <nav aria-label="Diapositivas de la edición" className="mb-5 flex flex-wrap gap-2">
      {TITLES.map((title, i) => <button key={title} type="button" onClick={() => setActive(i)} aria-label={title} aria-current={active === i ? "step" : undefined} className={`rounded-full border px-4 py-2 text-sm ${active === i ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{i + 1}</button>)}
    </nav>
    <div role="region" aria-label={`Diapositiva ${active + 1} de ${TITLES.length}: ${TITLES[active]}`}>
      <article id="zona-slide-1" hidden={active !== 0} className={slideClass}>
        {heading(0)}
        {facts.length > 0 && <ul className="space-y-4">{facts.map(f => <li key={f.id} className="rounded-xl bg-muted/50 p-4">
          <p className="text-sm text-muted-foreground">{f.kind === "holiday" ? "Feriado nacional" : "Agenda local"} · <time dateTime={f.start}>{f.start}</time>{f.end !== f.start && ` al ${f.end}`}</p>
          <h3 className="mt-1 font-semibold">{f.title}</h3>
          <p className="mt-2 text-sm">Oportunidad general: preparar información útil para quienes estén considerando viajar en estas fechas. No implica una previsión de reservas.</p>
          <a href={f.url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block break-words text-sm underline">{f.publisher} ↗</a>
          <p className="mt-1 text-xs text-muted-foreground">Publicación: {f.published} · Consulta editorial: {f.checked} · Vigente al recopilar hasta: {f.validUntil}</p>
        </li>)}</ul>}
        <div className="mt-5 space-y-2 text-sm text-muted-foreground">{material.warnings.map(w => <p key={w}>{w}</p>)}</div>
      </article>
      <article id="zona-slide-2" hidden={active !== 1} className={slideClass}>
        {heading(1)}
        <p className="max-w-2xl text-lg leading-relaxed">{facts.length ? "Las fechas públicas ofrecen una ventana para orientar información a quienes planifican una escapada. Es una oportunidad a explorar, no evidencia de mayor demanda." : "Sin una agenda corroborada ni estadísticas de públicos del destino, no hay base para afirmar tendencias de demanda."}</p>
        <div className="mt-6 rounded-xl bg-muted/50 p-4"><h3 className="font-semibold">Una métrica para empezar</h3><p className="mt-2">{PRACTICES.interests.text}</p><p className="mt-3 text-sm text-muted-foreground">Señal: {PRACTICES.interests.signal}.</p></div>
      </article>
      <article id="zona-slide-3" hidden={active !== 2} className={slideClass}>
        {heading(2)}<h3 className="text-xl font-medium">{commercial.title}</h3><p className="mt-4 max-w-2xl text-lg leading-relaxed">{commercial.text}</p>
        <p className="mt-6 text-sm text-muted-foreground">No se analizaron tarifas, ocupación ni resultados de ningún alojamiento. No hay base para recomendar aumentos o bajas de precios.</p>
      </article>
      <article id="zona-slide-4" hidden={active !== 3} className={slideClass}>
        {heading(3)}<h3 className="text-xl font-medium">{operational.title}</h3><p className="mt-4 max-w-2xl text-lg leading-relaxed">{operational.text}</p>
        <p className="mt-6 rounded-xl bg-muted/50 p-4">Señal a medir: {operational.signal}.</p>
      </article>
      <article id="zona-slide-5" hidden={active !== 4} className={slideClass}>
        {heading(4)}
        <ol className="space-y-4">{selection.actions.map((id, index) => {
          const action = PRACTICES[id]
          return <li key={id} className="rounded-xl bg-muted/50 p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">Prioridad {index + 1} · {index === 0 ? "Semana 1" : index === 1 ? "Semana 2" : "Semanas 3 y 4"} · Esfuerzo {action.effort}</p><h3 className="mt-2 font-semibold">{action.title}</h3><p className="mt-2">{action.text}</p><p className="mt-3 text-sm text-muted-foreground">Señal a medir: {action.signal}.</p></li>
        })}</ol>
        <p className="mt-8 border-t pt-6 text-lg font-medium">{CLOSING}</p>
      </article>
    </div>
    <div className="mt-5 flex items-center justify-between gap-3" aria-label="Controles de presentación">
      <button type="button" disabled={active === 0} onClick={() => setActive(current => current - 1)} className="rounded-lg border px-4 py-3 text-sm disabled:opacity-40">Anterior</button>
      <span className="text-sm text-muted-foreground" aria-live="polite">{active + 1} / {TITLES.length}</span>
      <button type="button" disabled={active === TITLES.length - 1} onClick={() => setActive(current => current + 1)} className="rounded-lg border px-4 py-3 text-sm disabled:opacity-40">Siguiente</button>
    </div>
  </>
}
