import { useEffect, useMemo, useState } from "react";
import { AuthFlow } from "@togo-framework/ui";
import { BrandDescriptor, BrandLockup, CubeMark, FADY_MONDY_MARK } from "../components/brand";
import { auth, clearSession, makeAuthClient } from "../lib/auth";

// Full-screen sign-in for the CaBrain console, drawn on the grid from CaBrain Brand.dc.html:
// an indigo brand panel — the violet checkerboard strip, the lockup, and the brand's recall
// panel — beside the bare togo AuthFlow form on the ground. AuthFlow keeps all of the auth
// logic (email-first, password, 2FA, CSRF via lib/auth); withCard={false} drops its own card
// and brand panel so this page owns the brand.
//
// The panel is indigo in both themes: it is the brand's cover, and "memory is read on a dark
// ground". Its colours are the brand's own constants, not theme tokens, for that reason.

const INDIGO = "#0e1a3c";
const PANEL_LINE = "#25355c";

// The brand sheet's recall panel: the top hit takes the light violet, the rest the violet.
const RECALL = [
  { text: "deploy pipeline broke on redis", score: "0.94", top: true },
  { text: "redis timeout after migration", score: "0.88", top: false },
  { text: "queue worker restart notes", score: "0.81", top: false },
];

// The checkerboard is never placed behind the mark — it only ever fills its own strip.
const checker = (a: string, b: string, px: number) => ({
  backgroundImage: `repeating-conic-gradient(${a} 0% 25%, ${b} 0% 50%)`,
  backgroundSize: `${px}px ${px}px`,
});

export function LoginPage({ onSignedIn }: { onSignedIn: () => void }) {
  // Only advertise the developer login when the backend actually exposes it
  // (auth-dev is disabled in production) so the button never lies. LoginForm shows
  // "Continue as dev" iff the client exposes devLogin, so gate it on this.
  const [devAvailable, setDevAvailable] = useState(false);
  useEffect(() => {
    let alive = true;
    auth.methods()
      .then((ms) => { if (alive) setDevAvailable(ms.some((m) => m.type === "dev")); })
      .catch(() => { /* fail closed: no dev button */ });
    return () => { alive = false; };
  }, []);

  const client = useMemo(() => makeAuthClient({ dev: devAvailable }), [devAvailable]);

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {/* ── Brand panel (desktop) ─────────────────────────────────────────── */}
      <aside
        className="hidden text-[#f0ebe1] lg:grid lg:grid-cols-[168px_minmax(0,1fr)]"
        style={{ backgroundColor: INDIGO, borderInlineEnd: `1px solid ${PANEL_LINE}` }}
      >
        <div aria-hidden style={checker("#6d4de6", INDIGO, 46)} />

        <div className="flex flex-col justify-between gap-14 px-12 py-14">
          <div className="flex flex-col gap-7">
            <span dir="ltr" className="font-mono text-[11px] font-medium uppercase tracking-[0.34em] text-[#a98cf5]">
              Console
            </span>
            <div className="flex items-center gap-5">
              <CubeMark size={64} tone="on-dark" title="CaBrain" />
              <span dir="ltr" className="text-[40px] font-medium leading-none tracking-[-0.015em]">CaBrain</span>
            </div>
            <p className="max-w-[46ch] text-[15px] font-light leading-[1.9] text-[#a9b1c6]">
              A memory layer for AI agents, built on embeddings. Everything an agent says is kept by
              meaning, not by wording — and comes back when a new question resembles it.
            </p>
          </div>

          {/* The brand's recall panel */}
          <figure dir="ltr" className="flex flex-col gap-3.5 p-5" style={{ border: `1px solid ${PANEL_LINE}` }}>
            <div className="flex items-center justify-between gap-3 pb-3" style={{ borderBottom: `1px solid ${PANEL_LINE}` }}>
              <span className="flex items-center gap-2.5">
                <CubeMark size={22} tone="on-dark" />
                <span className="text-[13.5px] font-medium">CaBrain</span>
              </span>
              <span className="font-mono text-[11px] text-[#a9b1c6]">recall · top 3</span>
            </div>
            <ul className="flex flex-col gap-2.5">
              {RECALL.map((r) => (
                <li key={r.text} className="flex items-center gap-2.5">
                  <span aria-hidden className="size-[9px] shrink-0" style={{ background: r.top ? "#a98cf5" : "#6d4de6" }} />
                  <span className={`min-w-0 flex-1 truncate text-[12.5px] ${r.top ? "text-[#f0ebe1]" : "text-[#a9b1c6]"}`}>{r.text}</span>
                  <span className="font-mono text-[11px] tabular-nums text-[#a9b1c6]">{r.score}</span>
                </li>
              ))}
            </ul>
          </figure>

          {/* Co-signature: the parent mark, a slash, the product mark. */}
          <div dir="ltr" className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-3">
              <CubeMark mark={FADY_MONDY_MARK} size={26} tone="on-dark" title="Fady Mondy" />
              <span aria-hidden className="text-[22px] font-light text-[#b9a88c]">/</span>
              <CubeMark size={30} tone="on-dark" />
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#a98cf5]">By Fady Mondy</span>
          </div>
        </div>
      </aside>

      {/* ── Form on the ground ───────────────────────────────────────────── */}
      <main className="flex min-h-screen min-w-0 flex-col">
        {/* Mobile: the active-texture band stands in for the panel, above — never behind — the mark. */}
        <div aria-hidden className="h-3 lg:hidden" style={checker("var(--cb-violet)", "var(--grid-bg)", 12)} />

        <div className="flex flex-1 items-center justify-center px-6 py-12 sm:px-10">
          <div className="w-full min-w-0 max-w-sm">
            <div className="mb-10 lg:hidden">
              <BrandLockup size={36} />
            </div>
            <div className="mb-8 hidden lg:block">
              <BrandDescriptor />
            </div>
            <AuthFlow
              authClient={client}
              withCard={false}
              onLanguageToggle={null}
              onSuccess={() => { clearSession(); onSignedIn(); }}
            />
          </div>
        </div>

        <footer className="flex items-center justify-between gap-4 border-t border-border px-6 py-4 font-mono text-[10.5px] uppercase tracking-[0.2em] text-muted-foreground">
          <span>CaBrain console</span>
          <span dir="ltr" className="normal-case tracking-normal">{window.location.host}</span>
        </footer>
      </main>
    </div>
  );
}
