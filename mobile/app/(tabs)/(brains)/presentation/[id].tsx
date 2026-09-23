import { useLocalSearchParams } from "expo-router";

import { PresentationDetail } from "@/features/presentations/presentation-detail";

// /presentation/{id} — one presentation (MH-369). The screen lives with its
// feature in src/features/presentations.
export default function PresentationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PresentationDetail id={String(id ?? "")} />;
}
