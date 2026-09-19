/** The owner's pages for a brain's documents: /{locale}/b/{namespace}/presentations[/{id}]. */
export function presentationsHref(locale: string, namespace: string, id?: string): string {
  const base = `/${locale}/b/${encodeURIComponent(namespace)}/presentations`
  return id ? `${base}/${encodeURIComponent(id)}` : base
}
