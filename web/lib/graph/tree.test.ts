import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  MAX_DEPTH,
  blockedReason,
  childrenOf,
  expandable,
  rowKey,
  rootNode,
  type GraphEdge,
} from "./tree.ts"

/*
The projection is the whole risk in the tree view: get it wrong and the
sidebar either expands forever or quietly hides real relationships. These
tests encode the four rules from tree.ts so a future change has to argue with
them rather than slip past.
*/

const edge = (src: string, dst: string, relation = "rel"): GraphEdge => ({
  id: `${src}->${dst}:${relation}`,
  src,
  dst,
  relation,
})

describe("direction", () => {
  test("only outgoing edges become children", () => {
    const kids = childrenOf(rootNode("a"), [edge("a", "b"), edge("c", "a")])
    assert.deepEqual(kids.map((k) => k.id), ["b"])
  })

  test("an incoming edge alone yields no children", () => {
    assert.deepEqual(childrenOf(rootNode("a"), [edge("z", "a")]), [])
  })

  // Without the direction rule, two mutually-related entities ping-pong forever.
  test("a mutual pair does not produce a child in both directions at once", () => {
    const kids = childrenOf(rootNode("a"), [edge("a", "b"), edge("b", "a")])
    assert.deepEqual(kids.map((k) => k.id), ["b"])
  })
})

describe("cycles", () => {
  test("a child already on its ancestor path is marked cyclic", () => {
    const a = rootNode("a")
    const b = childrenOf(a, [edge("a", "b")])[0]
    const backToA = childrenOf(b, [edge("b", "a")])[0]
    assert.equal(backToA.id, "a")
    assert.equal(backToA.cyclic, true)
  })

  test("a cyclic node is shown, not hidden — the relationship is real", () => {
    const a = rootNode("a")
    const b = childrenOf(a, [edge("a", "b")])[0]
    assert.equal(childrenOf(b, [edge("b", "a")]).length, 1)
  })

  test("a cyclic node cannot expand, so traversal terminates", () => {
    const a = rootNode("a")
    const b = childrenOf(a, [edge("a", "b")])[0]
    const backToA = childrenOf(b, [edge("b", "a")])[0]
    assert.equal(expandable(backToA), false)
    assert.deepEqual(childrenOf(backToA, [edge("a", "b")]), [])
    assert.equal(blockedReason(backToA), "cycle")
  })

  test("a self-edge is cyclic immediately", () => {
    const self = childrenOf(rootNode("a"), [edge("a", "a")])[0]
    assert.equal(self.cyclic, true)
  })

  test("a repeat that is NOT an ancestor is not cyclic — that is a diamond", () => {
    // a -> b, a -> c, b -> d, c -> d. d under c is not on c's ancestor path.
    const a = rootNode("a")
    const [b, c] = childrenOf(a, [edge("a", "b", "r1"), edge("a", "c", "r2")])
    const dUnderB = childrenOf(b, [edge("b", "d")])[0]
    const dUnderC = childrenOf(c, [edge("c", "d")])[0]
    assert.equal(dUnderB.cyclic, false)
    assert.equal(dUnderC.cyclic, false)
    // Same entity, different rows.
    assert.equal(dUnderB.id, dUnderC.id)
    assert.notEqual(rowKey(dUnderB), rowKey(dUnderC))
  })
})

describe("depth", () => {
  test("expansion stops at the cap", () => {
    let node = rootNode("n0")
    for (let i = 1; i <= MAX_DEPTH; i++) {
      const kids = childrenOf(node, [edge(`n${i - 1}`, `n${i}`)])
      assert.equal(kids.length, 1, `stopped early at depth ${i}`)
      node = kids[0]
    }
    assert.equal(node.depth, MAX_DEPTH)
    assert.equal(expandable(node), false)
    assert.deepEqual(childrenOf(node, [edge(`n${MAX_DEPTH}`, "further")]), [])
    assert.equal(blockedReason(node), "depth")
  })
})

describe("stability and identity", () => {
  test("rows are ordered deterministically", () => {
    const edges = [edge("a", "z", "b-rel"), edge("a", "y", "a-rel"), edge("a", "x", "a-rel")]
    const once = childrenOf(rootNode("a"), edges).map((k) => k.id)
    const twice = childrenOf(rootNode("a"), [...edges].reverse()).map((k) => k.id)
    assert.deepEqual(once, twice, "order depends on input order")
    assert.deepEqual(once, ["x", "y", "z"])
  })

  test("several relations to the same entity yield one row", () => {
    const kids = childrenOf(rootNode("a"), [edge("a", "b", "knows"), edge("a", "b", "owns")])
    assert.equal(kids.length, 1)
  })

  test("trails record the ancestor chain and keys stay unique per row", () => {
    const a = rootNode("a")
    const b = childrenOf(a, [edge("a", "b")])[0]
    assert.deepEqual(b.trail, ["a", "b"])
    assert.notEqual(rowKey(a), rowKey(b))
  })

  // Regression: an earlier version stored the trail as a delimited string, so
  // an id containing the delimiter split into extra segments and the ancestor
  // set held fragments — which could report an unrelated node as a cycle.
  test("an id containing a delimiter cannot corrupt cycle detection", () => {
    const weird = "a\u001fb"
    const root = childrenOf(rootNode("root"), [edge("root", weird)])[0]
    assert.deepEqual(root.trail, ["root", weird], "the id was split")
    // A node genuinely named "a" further down must NOT look like an ancestor.
    const kid = childrenOf(root, [edge(weird, "a")])[0]
    assert.equal(kid.cyclic, false)
  })

  test("no edges means no children, not an error", () => {
    assert.deepEqual(childrenOf(rootNode("a"), []), [])
  })
})
