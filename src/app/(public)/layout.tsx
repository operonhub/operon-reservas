export default function PublicLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <div className="min-h-screen bg-muted/20">{children}</div>
}
