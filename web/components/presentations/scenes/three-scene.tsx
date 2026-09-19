"use client"

import { useEffect, useRef } from "react"
import * as THREE from "three"

import { bool, int, num, oneOf, strings, token } from "@/lib/presentations/scene-params"
import { onThemeChange, prefersReducedMotion, tokenRGB } from "./color"

/*
The vetted three.js scenes (FM-346): particles, globe, floating_geometry,
product_orbit. Loaded only on the client (next/dynamic, ssr:false, from
scene.tsx). Every param is re-clamped here; nothing in a scene config is
evaluated as code. The loop pauses when the canvas is off screen, renders a
single still frame under prefers-reduced-motion, and releases the GPU on
unmount. `data-frames` counts rendered frames so a check can prove it animates.
*/

type Params = Record<string, unknown>

type Built = { update: (t: number) => void; recolor: () => void; dispose: () => void; camera: THREE.PerspectiveCamera }

function rgb(el: Element, name: string): THREE.Color {
  const [r, g, b] = tokenRGB(el, name)
  return new THREE.Color(r / 255, g / 255, b / 255)
}

function disposeScene(scene: THREE.Scene) {
  scene.traverse((o) => {
    const m = o as THREE.Mesh
    m.geometry?.dispose?.()
    const mat = m.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
    else mat?.dispose?.()
  })
}

function particles(scene: THREE.Scene, el: Element, p: Params): Built {
  const count = int(p, "count", 100, 5000, 1500)
  const spread = num(p, "spread", 2, 30, 12)
  const speed = num(p, "speed", 0, 3, 0.6)
  const color = token(p, "color", "brand")
  const positions = new Float32Array(count * 3)
  let seed = 7
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
  for (let i = 0; i < count * 3; i++) positions[i] = rand() * spread
  const geo = new THREE.BufferGeometry()
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3))
  const mat = new THREE.PointsMaterial({ size: num(p, "size", 0.5, 6, 2) * 0.03, color: rgb(el, color), transparent: true, opacity: 0.85 })
  const points = new THREE.Points(geo, mat)
  scene.add(points)
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200)
  camera.position.z = spread * 1.6
  return {
    camera,
    update: (t) => {
      points.rotation.y = t * 0.05 * speed
      points.rotation.x = Math.sin(t * 0.03 * speed) * 0.3
    },
    recolor: () => mat.color.copy(rgb(el, color)),
    dispose: () => disposeScene(scene),
  }
}

function globe(scene: THREE.Scene, el: Element, p: Params): Built {
  const n = int(p, "points", 100, 4000, 1200)
  const arcs = int(p, "arcs", 0, 24, 8)
  const turns = num(p, "rotation_speed", 0, 20, 3)
  const dotColor = token(p, "color", "brand")
  const arcColor = token(p, "arc_color", "accent")
  const group = new THREE.Group()
  const pts = new Float32Array(n * 3)
  const golden = Math.PI * (3 - Math.sqrt(5))
  const vecs: THREE.Vector3[] = []
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2
    const r = Math.sqrt(1 - y * y)
    const th = golden * i
    const v = new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r).multiplyScalar(2)
    vecs.push(v)
    pts.set([v.x, v.y, v.z], i * 3)
  }
  const dg = new THREE.BufferGeometry()
  dg.setAttribute("position", new THREE.BufferAttribute(pts, 3))
  const dm = new THREE.PointsMaterial({ size: 0.035, color: rgb(el, dotColor) })
  group.add(new THREE.Points(dg, dm))
  const am = new THREE.LineBasicMaterial({ color: rgb(el, arcColor), transparent: true, opacity: 0.9 })
  for (let i = 0; i < arcs; i++) {
    const a = vecs[(i * 7919) % n]
    const b = vecs[(i * 104729 + 13) % n]
    const mid = a.clone().add(b).normalize().multiplyScalar(2 + a.distanceTo(b) * 0.35)
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b)
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(40)), am))
  }
  group.rotation.z = 0.35
  scene.add(group)
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
  camera.position.z = 6.2
  return {
    camera,
    update: (t) => {
      group.rotation.y = (t / 60) * turns * Math.PI * 2
    },
    recolor: () => {
      dm.color.copy(rgb(el, dotColor))
      am.color.copy(rgb(el, arcColor))
    },
    dispose: () => disposeScene(scene),
  }
}

function geometryFor(shape: string): THREE.BufferGeometry {
  switch (shape) {
    case "torus":
      return new THREE.TorusGeometry(0.6, 0.22, 16, 48)
    case "box":
      return new THREE.BoxGeometry(0.9, 0.9, 0.9)
    case "torus_knot":
      return new THREE.TorusKnotGeometry(0.5, 0.16, 96, 12)
    case "octahedron":
      return new THREE.OctahedronGeometry(0.7)
    default:
      return new THREE.IcosahedronGeometry(0.7)
  }
}

function floating(scene: THREE.Scene, el: Element, p: Params): Built {
  const shape = oneOf(p, "shape", ["torus", "icosahedron", "box", "torus_knot", "octahedron"], "icosahedron")
  const count = int(p, "count", 1, 24, 6)
  const wire = bool(p, "wireframe", true)
  const speed = num(p, "speed", 0, 3, 0.8)
  const color = token(p, "color", "brand")
  const mat = new THREE.MeshStandardMaterial({ color: rgb(el, color), wireframe: wire, roughness: 0.4, metalness: 0.2 })
  const meshes: THREE.Mesh[] = []
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(geometryFor(shape), mat)
    const a = (i / count) * Math.PI * 2
    m.position.set(Math.cos(a) * 3, Math.sin(a * 2) * 1.2, Math.sin(a) * 1.5 - 1)
    m.scale.setScalar(0.6 + ((i * 37) % 10) / 20)
    meshes.push(m)
    scene.add(m)
  }
  scene.add(new THREE.AmbientLight(0xffffff, 0.6))
  const light = new THREE.DirectionalLight(0xffffff, 1.2)
  light.position.set(3, 4, 5)
  scene.add(light)
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
  camera.position.z = 7
  return {
    camera,
    update: (t) => {
      meshes.forEach((m, i) => {
        m.rotation.x = t * 0.4 * speed + i
        m.rotation.y = t * 0.3 * speed + i * 0.5
        m.position.y += Math.sin(t * speed + i) * 0.002
      })
    },
    recolor: () => mat.color.copy(rgb(el, color)),
    dispose: () => disposeScene(scene),
  }
}

function orbit(scene: THREE.Scene, el: Element, p: Params): Built {
  const labels = strings(p, "labels", 8, 40)
  const n = Math.max(2, labels.length)
  const radius = num(p, "orbit_radius", 2, 10, 4)
  const speed = num(p, "speed", 0, 3, 0.7)
  const coreC = token(p, "core_color", "brand")
  const satC = token(p, "satellite_color", "accent")
  const coreMat = new THREE.MeshStandardMaterial({ color: rgb(el, coreC), roughness: 0.35 })
  const satMat = new THREE.MeshStandardMaterial({ color: rgb(el, satC), roughness: 0.5 })
  const ringMat = new THREE.LineBasicMaterial({ color: rgb(el, satC), transparent: true, opacity: 0.35 })
  scene.add(new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), coreMat))
  const ring = new THREE.EllipseCurve(0, 0, radius, radius).getPoints(96).map((v) => new THREE.Vector3(v.x, 0, v.y))
  scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ring), ringMat))
  const sats: THREE.Mesh[] = []
  for (let i = 0; i < n; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.28, 24, 16), satMat)
    sats.push(s)
    scene.add(s)
  }
  scene.add(new THREE.AmbientLight(0xffffff, 0.55))
  const light = new THREE.PointLight(0xffffff, 40)
  light.position.set(4, 6, 6)
  scene.add(light)
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
  camera.position.set(0, radius * 0.9, radius * 2.4)
  camera.lookAt(0, 0, 0)
  return {
    camera,
    update: (t) => {
      sats.forEach((s, i) => {
        const a = t * 0.4 * speed + (i / n) * Math.PI * 2
        s.position.set(Math.cos(a) * radius, Math.sin(a * 2) * 0.2, Math.sin(a) * radius)
      })
    },
    recolor: () => {
      coreMat.color.copy(rgb(el, coreC))
      satMat.color.copy(rgb(el, satC))
      ringMat.color.copy(rgb(el, satC))
    },
    dispose: () => disposeScene(scene),
  }
}

const BUILDERS: Record<string, (s: THREE.Scene, el: Element, p: Params) => Built> = {
  particles,
  globe,
  floating_geometry: floating,
  product_orbit: orbit,
}

export default function ThreeScene({ type, params, label }: { type: string; params: Params; label: string }) {
  const host = useRef<HTMLDivElement>(null)
  const key = JSON.stringify(params)

  useEffect(() => {
    const el = host.current
    const build = BUILDERS[type]
    if (!el || !build) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" })
    } catch {
      el.dataset.error = "webgl"
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    el.appendChild(renderer.domElement)
    renderer.domElement.style.display = "block"
    const scene = new THREE.Scene()
    const built = build(scene, el, params)
    const resize = () => {
      const w = el.clientWidth || 1
      const h = el.clientHeight || 1
      renderer.setSize(w, h, true)
      built.camera.aspect = w / h
      built.camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    const stopTheme = onThemeChange(() => {
      built.recolor()
      renderer.render(scene, built.camera)
    })

    const still = prefersReducedMotion()
    let visible = true
    const io = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting)
    })
    io.observe(el)
    let frames = 0
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (!visible) return
      built.update((now - start) / 1000)
      renderer.render(scene, built.camera)
      frames++
      if (frames % 10 === 0 || frames < 10) el.dataset.frames = String(frames)
    }
    if (still) {
      built.update(2)
      renderer.render(scene, built.camera)
      el.dataset.frames = "1"
    } else {
      raf = requestAnimationFrame(tick)
    }
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      stopTheme()
      built.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the params value, not identity
  }, [type, key])

  const labels = type === "product_orbit" ? strings(params, "labels", 8, 40) : []
  return (
    <div className="relative size-full">
      <div ref={host} className="absolute inset-0" role="img" aria-label={label} data-scene={type} data-engine="three" />
      {labels.length ? (
        <ul className="pointer-events-none absolute bottom-3 start-3 flex flex-wrap gap-1.5 text-xs">
          {labels.map((l, i) => (
            <li key={i} className="rounded-full border bg-background/80 px-2 py-0.5 backdrop-blur">
              {l}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
