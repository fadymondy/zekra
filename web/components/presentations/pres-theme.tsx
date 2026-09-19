import { cn } from "@/lib/utils"

/**
 * The surface every viewer renders on (shared links, embeds, the editor's preview): the
 * grid's page ground and ink in light and dark. Viewers keep their own design; this only
 * pins the colours they resolve through.
 */
export function PresTheme({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("pres-surface bg-background text-foreground", className)} {...props} />
}
