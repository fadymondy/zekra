package mcptools

// mediaToolDefs are the media tools. A media file (image, PDF, video, audio) is
// read by the brain's media reader — OCR in any script, PDF text, video
// keyframes, speech-to-text — and its text is indexed through a companion note,
// so memory_recall finds what was in the picture, page or recording.
var mediaToolDefs = []map[string]any{
	{
		"name": "media_retain",
		"description": "Remember a media file: an image, PDF, video or audio. Pass the file as base64 `data` (with " +
			"`filename`) or a public http(s) `url`. The brain stores it, reads it in the background (OCR in any " +
			"language, PDF text, video keyframes + speech transcript) and indexes the text into a note " +
			"(category media), so memory_recall finds it. Returns the media with its id, noteId and status " +
			"(pending → processing → done|failed); poll media_get for the extracted text.",
		"inputSchema": obj(prop{
			"namespace": prop{"type": "string", "description": "the brain to store it in"},
			"data":      prop{"type": "string", "description": "the file, base64-encoded"},
			"filename":  prop{"type": "string", "description": "file name (helps detect the type), e.g. receipt.jpg"},
			"url":       prop{"type": "string", "description": "a public http(s) URL to fetch instead of data"},
			"title":     prop{"type": "string", "description": "optional note title (default: the file name)"},
		}, "namespace"),
	},
	{
		"name": "media_get",
		"description": "Fetch a media file's record: status, error, and the reader result — text per image / " +
			"page / video frame (with time) and speech segments (with start/end), plus line boxes.",
		"inputSchema": obj(prop{
			"id": prop{"type": "string", "description": "UUID of the media"},
		}, "id"),
	},
	{
		"name":        "media_list",
		"description": "List a brain's media files, newest first (without the extracted text; use media_get).",
		"inputSchema": obj(prop{
			"namespace": prop{"type": "string"},
			"kind":      prop{"type": "string", "description": "optional: image, pdf, video or audio"},
			"limit":     prop{"type": "integer"},
		}, "namespace"),
	},
}
