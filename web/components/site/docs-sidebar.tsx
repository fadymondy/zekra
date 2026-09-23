// Ported from fadymondy.com-v2 web/components/docs/docs-sidebar.tsx (unchanged apart from imports).
import Link from "next/link"
import { ChevronRightIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import type { DocPage, DocsBundle } from "@/lib/site/docs"

/*
The docs navigation (FM-6).

Built as a real TREE, not a flat list with indentation. A 300-page manual
rendered as one column of near-identical links tells the reader nothing about
what the thing is or where they are in it — which is the difference between
documentation and a folder of markdown.

  - Folders become sections, labelled with the folder's own index page title
    when it has one, so the label is the author's word rather than a slug.
  - A section's own index page leads it instead of sitting anonymously among
    its children.
  - Every section folds; long ones start folded, and the one containing the
    page you are reading opens itself.

Styling (2026-09-14, owner: "sidebar style need to be updated"): top-level
sections are mono eyebrows, nested ones read as ordinary medium-weight text, so
depth is carried by one indent guide rather than by three competing label
styles. Leading emoji in repo titles ("🚀 Install") are dropped here — they
broke the text alignment of every row — but stay on the page heading itself.

Order is the sync's (index first; folders by their index page's `order`, then
name; pages by frontmatter order, then title), so a repo controls it with
frontmatter alone.
*/

/** "getting-started" → "Getting started". Only used when a folder has no index. */
function prettify(segment: string): string {
  return segment.replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase())
}

/** Drops leading emoji/pictographs (and their joiners/variation selectors). */
function navTitle(title: string): string {
  const stripped = title
    .replace(/^(?:[\p{Extended_Pictographic}\p{Regional_Indicator}‍️⃣]|\s)+/u, "")
    .trim()
  return stripped || title
}

type Node = {
  /** Folder segment, or "" for the tree root. */
  segment: string
  path: string
  /** The folder's own index page, if the repo has one. */
  index?: DocPage
  pages: DocPage[]
  children: Node[]
}

function emptyNode(segment: string, path: string): Node {
  return { segment, path, pages: [], children: [] }
}

/** Group every page by its folder path, preserving the bundle's page order. */
function buildTree(pages: DocPage[]): Node {
  const root = emptyNode("", "")
  const byPath = new Map<string, Node>([["", root]])

  const nodeFor = (dir: string): Node => {
    const hit = byPath.get(dir)
    if (hit) return hit

    const cut = dir.lastIndexOf("/")
    const parent = nodeFor(cut < 0 ? "" : dir.slice(0, cut))
    const node = emptyNode(cut < 0 ? dir : dir.slice(cut + 1), dir)
    parent.children.push(node)
    byPath.set(dir, node)
    return node
  }

  for (const page of pages) {
    /*
      A page whose slug IS a folder other pages live under is that folder's
      index — "actions" beside "actions/groups" — so it leads the section
      instead of appearing as a sibling of its own children.
    */
    if (page.slug && pages.some((p) => p.slug.startsWith(`${page.slug}/`))) {
      nodeFor(page.slug).index = page
      continue
    }

    const cut = page.slug.lastIndexOf("/")
    nodeFor(cut < 0 ? "" : page.slug.slice(0, cut)).pages.push(page)
  }

  return root
}

function countPages(node: Node): number {
  return (
    node.pages.length +
    node.children.reduce((n, c) => n + countPages(c) + (c.index ? 1 : 0), 0)
  )
}

function contains(node: Node, slug: string): boolean {
  return (
    node.index?.slug === slug ||
    node.pages.some((p) => p.slug === slug) ||
    node.children.some((c) => contains(c, slug))
  )
}

/** More than this in one section and it starts folded. */
const COLLAPSE_OVER = 8

function PageLink({ page, base, activeSlug }: { page: DocPage; base: string; activeSlug: string }) {
  const active = page.slug === activeSlug
  return (
    <Link
      href={page.slug ? `${base}/${page.slug}` : base}
      aria-current={active ? "page" : undefined}
      className={cn(
        // -ms-px lays the active marker exactly over the section's guide line.
        "-ms-px block border-s py-1.5 ps-3 pe-2 leading-snug transition-colors",
        active
          ? "border-brand bg-muted/60 font-medium text-foreground"
          : "border-transparent text-muted-foreground hover:border-foreground/30 hover:text-foreground",
      )}
    >
      {navTitle(page.title)}
    </Link>
  )
}

function Section({
  node,
  base,
  activeSlug,
  depth,
  group,
}: {
  node: Node
  base: string
  activeSlug: string
  depth: number
  /** Shared by siblings: the parent's path. */
  group: string
}) {
  const label = navTitle(node.index?.title ?? prettify(node.segment))
  const holdsActive = contains(node, activeSlug)
  const total = countPages(node)
  const top = depth === 0

  return (
    /*
      Accordion per level (owner, 2026-09-14: opening a group must close the
      others under the same parent). Sibling <details> share a `name`, which
      makes the browser keep at most one of them open — no client JS. Only the
      section holding the current page starts open: with a shared name, a
      second open sibling would be closed on load anyway.
    */
    <details
      name={`docs-nav:${group}`}
      open={holdsActive}
      className={cn("group/section", top ? "" : "mt-1")}
    >
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center gap-1.5 py-1.5 select-none [&::-webkit-details-marker]:hidden",
          top
            ? "font-mono text-[12.5px] tracking-wider uppercase"
            : "ps-3 pe-2 text-sm font-medium",
          holdsActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        <ChevronRightIcon
          aria-hidden
          // Scale applies before rotate, so the mirrored RTL chevron (pointing
          // left) has to turn the other way to point down when open.
          className="size-3.5 shrink-0 transition-transform group-open/section:rotate-90 rtl:-scale-x-100 rtl:group-open/section:-rotate-90"
        />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {total > COLLAPSE_OVER ? (
          <span className="font-mono text-[12px] font-normal text-muted-foreground tabular-nums">
            {total}
          </span>
        ) : null}
      </summary>

      {/* One guide line per level, inset under the chevron. */}
      <div className={cn("flex flex-col border-s border-line", top ? "ms-1.5" : "ms-[1.125rem]")}>
        {node.index ? <PageLink page={node.index} base={base} activeSlug={activeSlug} /> : null}
        {node.pages.map((page) => (
          <PageLink key={page.slug} page={page} base={base} activeSlug={activeSlug} />
        ))}
        {node.children.map((child) => (
          <Section
            key={child.path}
            node={child}
            base={base}
            activeSlug={activeSlug}
            depth={depth + 1}
            group={node.path}
          />
        ))}
      </div>
    </details>
  )
}

export function DocsSidebar({
  bundle,
  base,
  activeSlug,
}: {
  bundle: DocsBundle
  /*
    Passed in, not derived. A product site serves its docs without the product
    in the path, so the sidebar cannot know the shape on its own — and deriving
    it here once produced links that disagreed with the page they were on.
  */
  base: string
  activeSlug: string
}) {
  const tree = buildTree(bundle.pages)

  return (
    <nav className="flex flex-col gap-4 text-sm">
      {/* Top-level pages first: the overview and anything else at the root. */}
      {tree.pages.length > 0 ? (
        <div className="flex flex-col border-s border-line">
          {tree.pages.map((page) => (
            <PageLink key={page.slug || "index"} page={page} base={base} activeSlug={activeSlug} />
          ))}
        </div>
      ) : null}

      {tree.children.map((child) => (
        <Section
          key={child.path}
          node={child}
          base={base}
          activeSlug={activeSlug}
          depth={0}
          group=""
        />
      ))}
    </nav>
  )
}
