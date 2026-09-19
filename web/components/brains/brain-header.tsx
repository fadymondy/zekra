"use client"

// The brain overview's title block, drawn from the brain's profile: avatar (or colour/icon tile)
// + display name as the title, the description under it. The namespace id stays visible in the
// micro line because it is what agents and the API use.
import { BrainAvatar } from "@/components/brains/brain-cells"
import { Ltr } from "@/components/copy-field"
import { useBrainProfile } from "@/lib/brain-profile"

export function BrainTitle({ ns }: { ns: string }) {
  const p = useBrainProfile(ns).data?.profile
  const name = p?.displayName?.trim() || ns
  return (
    <span className="flex min-w-0 items-center gap-3">
      <BrainAvatar namespace={ns} profile={p} size={36} />
      <span dir="auto" className="truncate">
        {name}
      </span>
    </span>
  )
}

/** The namespace id (shown when a display name hides it). */
export function BrainMicro({ ns, label }: { ns: string; label: string }) {
  const p = useBrainProfile(ns).data?.profile
  if (!p?.displayName || p.displayName === ns) return <>{label}</>
  return (
    <>
      {label} · <Ltr mono>{ns}</Ltr>
    </>
  )
}

export function BrainDescription({ ns }: { ns: string }) {
  const p = useBrainProfile(ns).data?.profile
  if (!p?.description) return null
  return <span className="line-clamp-3 whitespace-pre-line">{p.description}</span>
}
