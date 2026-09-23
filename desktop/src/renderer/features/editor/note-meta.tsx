import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Hash, Plus, X } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CATEGORY_ICONS } from "@/lib/notes/note-icon-map";
import { noteIcon } from "@/lib/notes/note-icon";
import { cn } from "@/lib/utils";

import { useI18n } from "../../lib/i18n";
import { tagCounts, type TagCount } from "../notes/notes-api";

/*
The note's tags and category, under the title.

Tags: chips (× removes) and a searchable popover of the brain's tags by use,
with "Create “x”" — the web TagCombobox's behaviour. That component itself
cannot mount here: it reads the web's next-intl provider (which throws outside
it) and fetches same-origin, so this is its desktop twin over the proxied API.

Category: the curated vocabulary of the shared icon map, plus whatever the
note already carries.
*/

export function TagEditor({ namespace, token, tags, readOnly, onChange }: {
  namespace: string;
  token: string;
  tags: string[];
  readOnly: boolean;
  onChange: (tags: string[]) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [counts, setCounts] = useState<TagCount[] | null>(null);

  useEffect(() => {
    if (!open || counts) return;
    let alive = true;
    tagCounts(token, namespace)
      .then((c) => alive && setCounts(c))
      .catch(() => alive && setCounts([]));
    return () => {
      alive = false;
    };
  }, [open, counts, token, namespace]);

  const draft = q.trim().replace(/,/g, "").replace(/^#/, "");
  const list = useMemo(() => {
    const needle = draft.toLowerCase();
    return (counts ?? []).filter((x) => !needle || x.tag.toLowerCase().includes(needle)).slice(0, 80);
  }, [counts, draft]);
  const canCreate = draft && !tags.includes(draft) && !list.some((x) => x.tag === draft);

  function toggle(tag: string) {
    onChange(tags.includes(tag) ? tags.filter((x) => x !== tag) : [...tags, tag]);
    setQ("");
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-0.5 rounded-md border border-line bg-grid-card py-0.5 ps-1.5 pe-1 text-[11px] text-grid-body"
        >
          <Hash className="size-3 text-grid-muted" />
          <bdi>{tag}</bdi>
          {!readOnly ? (
            <button
              type="button"
              aria-label={t("editor.tagRemove", { tag })}
              onClick={() => toggle(tag)}
              className="rounded-sm p-px text-grid-muted hover:bg-grid-soft hover:text-grid-fg"
            >
              <X className="size-3" />
            </button>
          ) : null}
        </span>
      ))}
      {!readOnly ? (
        <Popover
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) setQ("");
          }}
        >
          <PopoverTrigger
            render={
              <button
                type="button"
                className="inline-flex items-center gap-0.5 rounded-md border border-dashed border-line px-1.5 py-0.5 text-[11px] text-grid-muted hover:border-grid-action hover:text-grid-fg"
              />
            }
          >
            <Plus className="size-3" />
            {tags.length ? "" : t("editor.tagAdd")}
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-0">
            <div className="border-b border-line p-2">
              <Input
                autoFocus
                value={q}
                placeholder={t("ws.tags.search")}
                className="h-8 text-sm"
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    if (draft) toggle(list.find((x) => x.tag.toLowerCase() === draft.toLowerCase())?.tag ?? draft);
                  }
                }}
              />
            </div>
            <div className="max-h-64 overflow-y-auto p-1">
              {canCreate ? (
                <button
                  type="button"
                  onClick={() => toggle(draft)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm hover:bg-grid-soft"
                >
                  <Plus className="size-3.5 text-grid-action" />
                  <span className="truncate">{t("ws.tags.create", { tag: draft })}</span>
                </button>
              ) : null}
              {counts === null ? (
                <p className="px-2 py-1.5 text-xs text-grid-muted">{t("ws.loading")}</p>
              ) : list.length === 0 && !canCreate ? (
                <p className="px-2 py-1.5 text-xs text-grid-muted">{t("ws.tags.none")}</p>
              ) : (
                list.map((x) => (
                  <button
                    key={x.tag}
                    type="button"
                    onClick={() => toggle(x.tag)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm hover:bg-grid-soft"
                  >
                    <Check className={cn("size-3.5", tags.includes(x.tag) ? "text-grid-action" : "invisible")} />
                    <bdi className="min-w-0 flex-1 truncate">{x.tag}</bdi>
                    <span dir="ltr" className="font-mono text-[10.5px] text-grid-muted">
                      {x.count}
                    </span>
                  </button>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}

const CURATED = Object.keys(CATEGORY_ICONS);

export function CategoryPicker({ value, readOnly, onChange }: {
  value: string;
  readOnly: boolean;
  onChange: (category: string) => void;
}) {
  const { t } = useI18n();
  const options = CURATED.includes(value) || !value ? CURATED : [value, ...CURATED];
  const current = noteIcon(value || "note");
  const label = value || "note";

  const trigger = (
    <button
      type="button"
      disabled={readOnly}
      aria-label={t("ws.category")}
      title={t("ws.category")}
      className="inline-flex items-center gap-1 rounded-md border border-line bg-grid-card px-1.5 py-0.5 text-[11px] text-grid-body hover:bg-grid-soft disabled:opacity-80"
    />
  );

  if (readOnly) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-line bg-grid-card px-1.5 py-0.5 text-[11px] text-grid-body">
        <current.Icon className="size-3" style={{ color: current.color }} />
        {label}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger}>
        <current.Icon className="size-3" style={{ color: current.color }} />
        <bdi>{label}</bdi>
        <ChevronDown className="size-3 text-grid-muted" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 min-w-44 overflow-y-auto">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("ws.category")}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={label} onValueChange={(v) => onChange(String(v))}>
            {options.map((c) => {
              const { Icon, color } = noteIcon(c);
              return (
                <DropdownMenuRadioItem key={c} value={c}>
                  <Icon className="size-3.5" style={{ color }} />
                  {c}
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
