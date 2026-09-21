/*
Projecting the entity graph onto a tree.

THE PROBLEM THIS SOLVES. A tree view needs a parent/child hierarchy, and the
entity graph is not one: it is a directed graph that can contain cycles
(A -> B -> A) and diamonds (two parents reaching the same child). Rendering it
naively expands forever, or silently hides real relationships.

THE PROJECTION, stated so it can be argued with:

  1. Direction. Only OUTGOING edges become children (src === node). An
     undirected reading would make every edge appear twice — once in each
     direction — and turn any pair of related entities into an infinite
     ping-pong.

  2. Cycles. A node whose id already appears on its OWN ancestor path is
     rendered, but marked `cyclic` and cannot expand. It is shown rather than
     hidden because "X relates back to an ancestor" is real information; it is
     not expanded because doing so never terminates.

  3. Diamonds are ALLOWED. The same entity may appear under two different
     parents, each expandable. Deduplicating globally would silently drop a
     genuine relationship from one branch, which is worse than showing it
     twice — the graph really does connect it twice.

  4. Depth. A hard cap, because a long chain is a scrolling accident rather
     than a useful view, and because each level costs a request.

Expansion is lazy: children are fetched when a node is disclosed, never up
front. A brain with thousands of entities must not fetch them all to draw a
sidebar.
*/

export interface GraphEdge {
  id: string
  src: string
  dst: string
  relation: string
}

export interface TreeNode {
  /** Entity id. NOT unique across the tree — a diamond repeats it. */
  id: string
  /**
   * Ancestor ids, root first, INCLUDING this node.
   *
   * Held as an array rather than a delimited string on purpose: entity ids are
   * opaque, and any separator we picked could appear inside one. A string path
   * would then split into the wrong segments and the ancestor set would hold
   * fragments, so an unrelated node could be falsely reported as a cycle.
   */
  trail: string[]
  /** The relation that led here, absent at a root. */
  relation?: string
  depth: number
  /** True when this id is already on its own ancestor path. */
  cyclic: boolean
}

export const MAX_DEPTH = 8

/**
 * A stable React key for one row. Derived from the trail rather than being the
 * source of truth, so a separator collision can at worst duplicate a key — it
 * can no longer corrupt cycle detection.
 */
export function rowKey(node: TreeNode): string {
  return node.trail.map((id) => encodeURIComponent(id)).join("/")
}

/**
 * Children of one node, from its edge list.
 *
 * Sorted by relation then id so the tree is stable between renders — an
 * unstable order makes a sidebar unusable, since rows move under the cursor.
 */
export function childrenOf(
  parent: TreeNode,
  edges: GraphEdge[],
): TreeNode[] {
  if (parent.cyclic || parent.depth >= MAX_DEPTH) return []
  // Exact id comparison — no parsing, so no way to mistake a fragment for an id.
  const ancestors = new Set(parent.trail)

  const seen = new Set<string>()
  const out: TreeNode[] = []
  for (const e of edges) {
    // Outgoing only — see (1) above.
    if (e.src !== parent.id) continue
    // One row per distinct child even if several relations connect them;
    // the relation shown is the first after sorting, which is deterministic.
    if (seen.has(e.dst)) continue
    seen.add(e.dst)
    out.push({
      id: e.dst,
      trail: [...parent.trail, e.dst],
      relation: e.relation,
      depth: parent.depth + 1,
      cyclic: ancestors.has(e.dst),
    })
  }
  return out.sort((a, b) => (a.relation ?? "").localeCompare(b.relation ?? "") || a.id.localeCompare(b.id))
}

export function rootNode(id: string): TreeNode {
  return { id, trail: [id], depth: 0, cyclic: false }
}

/** Can this row be disclosed at all? */
export function expandable(node: TreeNode): boolean {
  return !node.cyclic && node.depth < MAX_DEPTH
}

/**
 * Why a row cannot expand, for the UI to explain rather than just disabling a
 * chevron with no reason given.
 */
export function blockedReason(node: TreeNode): "cycle" | "depth" | null {
  if (node.cyclic) return "cycle"
  if (node.depth >= MAX_DEPTH) return "depth"
  return null
}
