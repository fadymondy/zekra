"use client"

import dynamic from "next/dynamic"
import { cn } from "cn"

import { CANVAS_SCENES, IFRAME_SCENES, THREE_SCENES } from "@/lib/presentations/scene-params"
import type { Scene } from "@/lib/presentations/types"
import { Skeleton } from "@/components/ui/skeleton"

/*
Scene switch (FM-346). three.js is a client-only chunk loaded on demand, so a
page without a 3D scene never downloads it and SSR never touches WebGL. An
unknown type renders nothing — the API refuses them, this is belt and braces.
"code" scenes run only in a sandboxed iframe (scenes/code-scene.tsx).
*/
const ThreeScene = dynamic(() => import("./three-scene"), {
  ssr: false,
  loading: () => <Skeleton className="size-full rounded-none" />,
})
const CanvasScene = dynamic(() => import("./canvas-scene"), { ssr: false })
const CodeScene = dynamic(() => import("./code-scene"), { ssr: false })

export function SceneView({
  scene,
  label,
  dir,
  className,
  fill = false,
}: {
  scene: Scene
  label: string
  dir: "ltr" | "rtl"
  className?: string
  /** Fill the parent (a hero backdrop) instead of keeping the scene's own aspect ratio. */
  fill?: boolean
}) {
  const params = scene.params ?? {}
  if ((IFRAME_SCENES as readonly string[]).includes(scene.type)) {
    return (
      <div className={cn("relative overflow-hidden", className)}>
        <CodeScene params={params} label={label} dir={dir} fill={fill} />
      </div>
    )
  }
  if ((THREE_SCENES as readonly string[]).includes(scene.type)) {
    return (
      <div className={cn("relative overflow-hidden", className)}>
        <ThreeScene type={scene.type} params={params} label={label} />
      </div>
    )
  }
  if ((CANVAS_SCENES as readonly string[]).includes(scene.type)) {
    return (
      <div className={cn("relative overflow-hidden", className)}>
        <CanvasScene type={scene.type} params={params} label={label} dir={dir} />
      </div>
    )
  }
  return null
}
