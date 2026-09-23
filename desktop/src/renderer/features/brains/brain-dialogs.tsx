import { useEffect, useState } from "react";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import {
  brainName,
  clampIcon,
  formatCount,
  PALETTE,
  slugify,
  validNamespace,
  type BrainListItem,
} from "@mobile/features/brains/brains-core";

import { ApiError } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { useAuthed } from "../../shell/session";
import { toast } from "../../shell/toast";
import { brainsApi, useInvalidateBrains } from "./brains-data";

/*
Create / delete a brain — the mobile sheets (new-brain-sheet.tsx,
brain-actions-sheet.tsx) as desktop dialogs, same rules:

  create  name -> namespace (slugify, editable), validated against the
          server's namespace rule before the button enables; then POST
          /api/brain/brains + a first marker memory so the brain exists for
          agents even where the create route answers 403 (web parity)
  delete  owners/admins only; type the namespace to confirm
*/

export function NewBrainDialog({ open, onOpenChange, onCreated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (namespace: string) => void;
}) {
  const { t } = useI18n();
  const { token } = useAuthed();
  const invalidate = useInvalidateBrains();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [desc, setDesc] = useState("");
  const [color, setColor] = useState("");
  const [icon, setIcon] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const namespace = slugEdited ? slug : slugify(name);
  const nsOk = validNamespace(namespace);

  useEffect(() => {
    if (open) return;
    setName("");
    setSlug("");
    setSlugEdited(false);
    setDesc("");
    setColor("");
    setIcon("");
    setError(null);
    setBusy(false);
  }, [open]);

  async function create() {
    if (!nsOk || busy) return;
    setBusy(true);
    setError(null);
    const displayName = name.trim();
    const description = desc.trim();
    const glyph = clampIcon(icon);
    try {
      try {
        await brainsApi.create(token, {
          namespace,
          ...(displayName && displayName !== namespace ? { displayName } : {}),
          ...(color ? { color } : {}),
          ...(description ? { description } : {}),
          ...(glyph ? { icon: glyph } : {}),
        });
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 403)) throw err;
      }
      await brainsApi.retain(token, {
        namespace,
        content: `Brain "${displayName || namespace}" created from the desktop app.${description ? " " + description : ""}`,
        sourceKind: "system",
        sourceRef: "desktop/new-brain",
      });
      await invalidate();
      toast.success(t("brains.new.created", { brain: displayName || namespace }));
      onOpenChange(false);
      onCreated(namespace);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setError(t("brains.new.exists"));
      else if (err instanceof ApiError && err.status === 400) setError(t("brains.new.invalid"));
      else if (err instanceof ApiError && err.status === 0) setError(t("brains.error.network"));
      else setError(err instanceof Error ? err.message : t("brains.error.network"));
    } finally {
      setBusy(false);
    }
  }

  const optional = (label: string) => `${label} · ${t("brains.new.optional")}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>{t("brains.new.title")}</DialogTitle>
            <DialogDescription>{t("brains.new.description")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="nb-name">{t("brains.new.name")}</Label>
            <Input
              id="nb-name"
              autoFocus
              value={name}
              maxLength={80}
              placeholder={t("brains.new.namePlaceholder")}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nb-ns">{t("brains.new.namespace")}</Label>
            <Input
              id="nb-ns"
              dir="ltr"
              value={namespace}
              maxLength={63}
              aria-invalid={namespace.length > 0 && !nsOk}
              className="font-mono"
              onChange={(e) => {
                setSlugEdited(true);
                setSlug(e.target.value.toLowerCase());
              }}
            />
            <p className={cn("text-xs", namespace.length > 0 && !nsOk ? "text-destructive" : "text-muted-foreground")}>
              {namespace.length > 0 && !nsOk ? t("brains.new.namespaceInvalid") : t("brains.new.namespaceHint")}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nb-desc">{optional(t("brains.new.descriptionLabel"))}</Label>
            <Textarea
              id="nb-desc"
              value={desc}
              rows={2}
              maxLength={280}
              placeholder={t("brains.new.descriptionPlaceholder")}
              onChange={(e) => setDesc(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-[1fr_auto] items-start gap-4">
            <div className="space-y-1.5">
              <Label>{optional(t("brains.new.color"))}</Label>
              <div role="radiogroup" aria-label={t("brains.new.color")} className="flex flex-wrap gap-1.5">
                <Swatch label={t("brains.new.colorNone")} selected={!color} onClick={() => setColor("")} />
                {PALETTE.map((c) => (
                  <Swatch key={c.key} label={c.key} hex={c.hex} selected={color === c.key} onClick={() => setColor(c.key)} />
                ))}
              </div>
            </div>
            <div className="w-28 space-y-1.5">
              <Label htmlFor="nb-icon">{t("brains.new.icon")}</Label>
              <Input
                id="nb-icon"
                value={icon}
                placeholder="🧠"
                title={t("brains.new.iconPlaceholder")}
                onChange={(e) => setIcon(clampIcon(e.target.value))}
                className="text-center text-lg"
              />
            </div>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("action.cancel")}
            </Button>
            <Button type="submit" disabled={!nsOk || busy}>
              {t("brains.new.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Swatch({ label, hex, selected, onClick }: { label: string; hex?: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "flex size-6 items-center justify-center rounded-full border transition",
        selected ? "ring-2 ring-grid-gold ring-offset-1 ring-offset-background" : "hover:scale-110",
        hex ? "border-transparent" : "border-border/60 bg-muted",
      )}
      style={hex ? { backgroundColor: hex } : undefined}
    >
      {selected ? <Check className={cn("size-3.5", hex ? "text-white" : "text-muted-foreground")} /> : null}
    </button>
  );
}

export function DeleteBrainDialog({ brain, onOpenChange, onDeleted }: {
  brain: BrainListItem | null;
  onOpenChange: (open: boolean) => void;
  onDeleted?: (namespace: string) => void;
}) {
  const { t } = useI18n();
  const { token } = useAuthed();
  const invalidate = useInvalidateBrains();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ns = brain?.namespace ?? "";

  useEffect(() => {
    setTyped("");
    setError(null);
    setBusy(false);
  }, [ns]);

  async function doDelete() {
    if (!brain || typed !== ns || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await brainsApi.remove(token, ns);
      await invalidate();
      toast.success(t("brains.delete.done", { brain: ns, count: formatCount(res?.deleted ?? 0) }));
      onOpenChange(false);
      onDeleted?.(ns);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 0
          ? t("brains.error.network")
          : err instanceof Error
            ? err.message
            : t("brains.error.network"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!brain} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void doDelete();
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>{t("brains.delete.title")}</DialogTitle>
            <DialogDescription>
              {t("brains.delete.description", { brain: brain ? brainName(brain) : "" })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="db-confirm">{t("brains.delete.typeToConfirm", { brain: ns })}</Label>
            <Input
              id="db-confirm"
              dir="ltr"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={typed}
              placeholder={ns}
              className="font-mono"
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("action.cancel")}
            </Button>
            <Button type="submit" variant="destructive" disabled={typed !== ns || busy}>
              {t("brains.delete.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
