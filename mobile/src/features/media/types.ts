// Media memories, typed to the JSON of plugins/brain/internal/brain/media.go
// (Media / MediaText). The same shapes as web/lib/media.ts.

export type MediaKind = "image" | "pdf" | "video" | "audio";
export type MediaStatus = "pending" | "processing" | "done" | "failed";

/** One read line of an image: text, confidence and its polygon on the image. */
export type MediaLine = { text: string; score: number; box: [number, number][]; script?: string };

export type MediaSegment = {
  kind: "image" | "page" | "frame" | "speech";
  page?: number;
  /** Seconds, for keyframes and speech. */
  start?: number;
  end?: number;
  text: string;
  lines?: MediaLine[];
  width?: number;
  height?: number;
};

export type MediaText = { width?: number; height?: number; duration?: number; segments: MediaSegment[] };

export type Media = {
  id: string;
  namespace: string;
  /** The companion note the reader writes the text into — what recall finds. */
  noteId?: string;
  kind: MediaKind;
  name: string;
  contentType: string;
  bytes: number;
  digest: string;
  status: MediaStatus;
  error?: string;
  result?: MediaText;
  /** API path of the file itself ("/api/brain/media/{id}/file"). */
  url: string;
  createdAt: string;
  updatedAt: string;
};

export type MediaList = { items: Media[]; total: number; reader: boolean };
