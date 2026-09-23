import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { EntityTree } from "@/components/graph/entity-tree";
import { useI18n } from "../lib/i18n";
import { zekraApi } from "../lib/api";

/*
The desktop tree view (MH-306), rooted on the brain's graph spine.

The tree itself is the web's EntityTree — lazy expansion, cycle and depth
handling, the projection in lib/graph/tree.ts and its tests. Only the two
things that cannot cross the boundary are supplied here: the fetch (desktop
talks cross-origin with a Bearer token, not same-origin with a CSRF cookie)
and the copy (there is no next-intl provider in the renderer).
*/
export function NoteTree({
  token,
  namespace,
  onSelect,
}: {
  token: string;
  namespace: string;
  onSelect?: (entity: string) => void;
}) {
  const { t } = useI18n();
  const [roots, setRoots] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await zekraApi.graphRoots(token, namespace);
      setRoots((res.roots ?? []).map((r) => r.name));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the tree");
    } finally {
      setLoading(false);
    }
  }, [token, namespace]);

  useEffect(() => { void load(); }, [load]);

  const loadEdges = useCallback(
    async (ns: string, entity: string) => (await zekraApi.graphNeighbors(token, ns, entity)).edges ?? [],
    [token],
  );

  if (loading) {
    return (
      <p className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
      </p>
    );
  }
  if (error) return <p className="px-3 py-4 text-sm text-destructive">{error}</p>;

  return (
    <EntityTree
      namespace={namespace}
      roots={roots}
      loadEdges={loadEdges}
      onSelect={onSelect}
      onRefresh={() => void load()}
      labels={{
        title: t("tree.title"),
        empty: t("tree.empty"),
        refresh: t("action.refresh"),
        expand: t("tree.expand"),
        collapse: t("tree.collapse"),
        cycle: t("tree.cycle"),
        deep: t("tree.deep"),
        retry: t("action.retry"),
        noChildren: t("tree.noChildren"),
      }}
    />
  );
}
