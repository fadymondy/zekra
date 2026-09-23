// The unread-count badge for the Windows taskbar overlay icon.
//
// macOS (Dock) and Linux (Unity launcher API) draw a count themselves via
// app.setBadgeCount; Windows only takes a 16x16 overlay IMAGE
// (BrowserWindow.setOverlayIcon), so the count is rasterised here: a red disc
// with the number in a tiny pixel font, 32x32 BGRA at scale 2. Pure (no
// Electron) so it is unit-tested; os-integration.ts wraps it in a nativeImage.
"use strict";

const GLYPHS: Record<string, string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  "+": ["000", "010", "111", "010", "000"],
};

export const BADGE_SIZE = 32;

/** "1".."9", then "9+". Empty for 0. */
export function badgeLabel(count: number): string {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (!n) return "";
  return n > 9 ? "9+" : String(n);
}

/** 32x32 BGRA pixels of the badge for `count` (null for 0). */
export function badgeBitmap(count: number, rgb: [number, number, number] = [0xe5, 0x48, 0x4d]): Buffer | null {
  const label = badgeLabel(count);
  if (!label) return null;
  const S = BADGE_SIZE;
  const buf = Buffer.alloc(S * S * 4);
  const set = (x: number, y: number, r: number, g: number, b: number, a: number) => {
    const i = (y * S + x) * 4;
    buf[i] = b;
    buf[i + 1] = g;
    buf[i + 2] = r;
    buf[i + 3] = a;
  };
  // Anti-aliased disc (4x4 supersampling per pixel).
  const c = S / 2;
  const radius = S / 2 - 0.5;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let hit = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const dx = x + (sx + 0.5) / 4 - c;
          const dy = y + (sy + 0.5) / 4 - c;
          if (dx * dx + dy * dy <= radius * radius) hit++;
        }
      }
      if (hit) set(x, y, rgb[0], rgb[1], rgb[2], Math.round((hit / 16) * 255));
    }
  }
  // Glyphs, centred: scale 4 for one character, 3 for two.
  const scale = label.length === 1 ? 4 : 3;
  const gap = label.length === 1 ? 0 : 2;
  const w = label.length * 3 * scale + (label.length - 1) * gap;
  const h = 5 * scale;
  const ox = Math.floor((S - w) / 2);
  const oy = Math.floor((S - h) / 2);
  [...label].forEach((ch, gi) => {
    const rows = GLYPHS[ch];
    const gx = ox + gi * (3 * scale + gap);
    rows.forEach((row, ry) => {
      [...row].forEach((bit, rx) => {
        if (bit !== "1") return;
        for (let py = 0; py < scale; py++) {
          for (let px = 0; px < scale; px++) set(gx + rx * scale + px, oy + ry * scale + py, 255, 255, 255, 255);
        }
      });
    });
  });
  return buf;
}
