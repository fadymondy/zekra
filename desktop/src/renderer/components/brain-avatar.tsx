import { brainHex, monogram } from "@mobile/features/brains/brains-core";

import { useAuthedImage } from "../lib/authed-image";

/*
A brain's avatar: its uploaded image if it has one, else its emoji icon, else
a two-letter mono monogram on the brain's colour — the web's BrainAvatar.

The serve route (/api/brain/profile/image/{ns}/{kind}) is members-only and
wants the bearer token, which an <img src> cannot send — and a file:// page's
own fetch is rejected by the API (Origin: null). useAuthedImage fetches the
bytes through the main process and returns an object URL.

`token` only gates the fetch (signed out: no request); the main process
attaches the stored token itself.
*/
export type AvatarBrain = {
  namespace: string;
  colorHex?: string;
  color?: string;
  icon?: string;
  imageUrl?: string;
};

export function BrainAvatar({ brain, token, size = 44 }: {
  brain: AvatarBrain;
  token: string | null;
  size?: number;
}) {
  const src = useAuthedImage(token ? brain.imageUrl : null);
  const hex = brainHex(brain);

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
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-md border"
      style={{
        width: size,
        height: size,
        background: hex ? `${hex}22` : "var(--grid-soft)",
        borderColor: hex ? `${hex}55` : "var(--grid-line)",
      }}
    >
      {brain.icon ? (
        // The owner's emoji, scaled to the box rather than the text size.
        <span style={{ fontSize: Math.round(size * 0.5), lineHeight: 1 }}>{brain.icon}</span>
      ) : (
        <span
          className="font-mono font-medium"
          dir="ltr"
          style={{ fontSize: Math.max(9, Math.round(size * 0.34)), color: hex || "var(--grid-action)", letterSpacing: "0.02em" }}
        >
          {monogram(brain.namespace)}
        </span>
      )}
    </span>
  );
}
