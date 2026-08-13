export function ComingSoon({
  title,
  stage,
}: {
  title: string
  stage: string
}) {
  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{title}</h1>
      </header>
      <div className="rounded-xl border border-dashed p-10 text-center">
        <p className="text-sm text-muted-foreground">
          Esta sección se construye en la {stage}.
        </p>
      </div>
    </div>
  )
}
