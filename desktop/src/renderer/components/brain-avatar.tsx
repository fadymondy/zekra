import { useEffect, useState } from "react";
import { BrainCircuit } from "lucide-react";

import { getApiBaseUrl, type Brain } from "../lib/api";

/*
A brain's avatar: its uploaded image if it has one, else its emoji icon, else
a tinted glyph.

WHY THIS IS NOT JUST AN <img src>. The serve route
(/api/brain/profile/image/{ns}/{kind}) is members-only and authenticates the
session — the web console can point an <img> at it because the cookie rides
along automatically. Desktop is an external client holding a Bearer token, and
a browser will not attach an Authorization header to an image request, so the
same markup would fetch a 403 and render a broken image.

So the bytes are fetched with the token and handed to the <img> as an object
URL, which is revoked when the component unmounts or the brain changes.
*/
export function BrainAvatar({ brain, token, size = 44 }: {
  brain: Brain;
  token: string | null;
  size?: number;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const hex = brain.colorHex;

  useEffect(() => {
    const path = brain.imageUrl;
    if (!path || !token) {
      setSrc(null);
      return;
    }
    let url: string | null = null;
    let alive = true;

    void (async () => {
      try {
        const res = await fetch(`${getApiBaseUrl()}${path}`, {
          headers: { Authorization: `Bearer ${token}`, "X-Agent-Id": "zekra-desktop" },
          credentials: "include",
        });
        if (!res.ok) return;
        const blob = await res.blob();
        if (!alive) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      } catch {
        // A missing avatar is not worth surfacing; the fallback below is fine.
      }
    })();

    return () => {
      alive = false;
      // Revoke on unmount or when the brain changes, or every list render
      // leaks one blob for the lifetime of the window.
      if (url) URL.revokeObjectURL(url);
    };
  }, [brain.imageUrl, token]);

  const box = {
    width: size,
    height: size,
    background: hex ? `${hex}22` : "var(--grid-soft)",
  } as const;

  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="shrink-0 rounded-md object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span aria-hidden className="flex shrink-0 items-center justify-center rounded-md" style={box}>
      {brain.icon ? (
        // The owner's emoji, scaled to the box rather than the text size.
        <span style={{ fontSize: Math.round(size * 0.5), lineHeight: 1 }}>{brain.icon}</span>
      ) : (
        <BrainCircuit style={{ width: size * 0.45, height: size * 0.45, color: hex || "var(--grid-action)" }} />
      )}
    </span>
  );
}
