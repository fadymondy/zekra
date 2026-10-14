import { useLocalSearchParams } from "expo-router";

import { MediaDetail } from "@/features/media/media-detail";

// /media/{id} — one media file and the text read from it. The screen lives
// with its feature in src/features/media.
export default function MediaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <MediaDetail id={String(id ?? "")} />;
}
