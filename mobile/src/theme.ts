import { useColorScheme } from "react-native";

const light = {
  bg: "#f0ebe1",
  card: "#f7f4ec",
  soft: "#ede7db",
  line: "#ded5c4",
  ink: "#0e1a3c",
  body: "#4a4438",
  muted: "#6e6551",
  elevated: "#faf8f3",
  elevatedLine: "#cfc3af",
  action: "#6d4de6",
  onAction: "#ffffff",
  gold: "#c9a227",
  ok: "#33702a",
  danger: "#b92f48",
};

const dark = {
  bg: "#0b1429",
  card: "#0e1a3c",
  soft: "#1a2747",
  line: "#25355c",
  ink: "#f0ebe1",
  body: "#c8d0e4",
  muted: "#8a97b8",
  elevated: "#18264a",
  elevatedLine: "#32456f",
  action: "#6d4de6",
  onAction: "#ffffff",
  gold: "#c9a227",
  ok: "#78bf68",
  danger: "#ff7790",
};

export type Palette = typeof light;
export function usePalette(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}

export const graphColors = ["#6d4de6", "#c9a227", "#4e9a3e", "#d9455f", "#7756a8", "#277f8e", "#bb6b30"];
