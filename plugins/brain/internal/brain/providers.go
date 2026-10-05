package brain

import (
	"context"

	"github.com/togo-framework/togo"
)

// Provider seams. The self-hosted embedding/rerank plane and the cognify engine
// are separate driver plugins (brain-tei, brain-cognee) that publish their
// implementations onto the kernel under the well-known keys below; brain reads
// them lazily on the hot path (order-independent — no boot coupling). When a
// provider is absent, the dependent op returns a clear "install <plugin>" error
// rather than silently degrading.

// Embedder turns text into dense vectors (TEI → BAAI/bge-m3, 1024-dim).
type Embedder interface {
	// Embed returns one vector per input text, each of length Dim().
	Embed(ctx context.Context, texts []string) ([][]float32, error)
	// Dim is the embedding width; must match the memories.embedding column.
	Dim() int
}

// Reranker reorders candidate documents against a query (bge-reranker-v2-m3).
type Reranker interface {
	// Rerank returns a relevance score per doc, aligned to the input order.
	Rerank(ctx context.Context, query string, docs []string) ([]float64, error)
}

// Engine is the cognify engine (Cognee): entity/graph extraction from a memory.
// Optional — retain/recall work without it; it enriches the entity graph used
// for 1-hop spreading activation.
type Engine interface {
	// Cognify extracts entities/relations for a stored memory and populates the
	// entities / memory_entities graph for the namespace.
	Cognify(ctx context.Context, namespace, memoryID, content string) error
}

// MediaReader turns media into text: OCR for images and scanned pages (any
// script), keyframe OCR plus speech for video, speech for audio (brain-ocr →
// the zekra-ocr service). Optional — without it media still uploads and is
// browsable, it just has no text to index until a reader is installed.
type MediaReader interface {
	// ReadMedia reads one file. kind is image|pdf|video|audio.
	ReadMedia(ctx context.Context, kind, filename string, data []byte) (*MediaText, error)
	// LiveURL is the websocket the live camera mode proxies to, with any auth
	// already applied ("" when live mode is unavailable).
	LiveURL() string
}

// MediaText is what a MediaReader extracted. Segments are in reading order:
// one per image, per PDF page, per video keyframe or per speech span.
type MediaText struct {
	Width    int            `json:"width,omitempty"`
	Height   int            `json:"height,omitempty"`
	Duration float64        `json:"duration,omitempty"`
	Segments []MediaSegment `json:"segments"`
}

// MediaSegment is one readable unit of a media file.
type MediaSegment struct {
	Kind   string      `json:"kind"`            // image | page | frame | speech
	Page   int         `json:"page,omitempty"`  // 1-based PDF page
	Start  *float64    `json:"start,omitempty"` // seconds (frames, speech)
	End    *float64    `json:"end,omitempty"`
	Text   string      `json:"text"`
	Lines  []MediaLine `json:"lines,omitempty"`
	Width  int         `json:"width,omitempty"`
	Height int         `json:"height,omitempty"`
}

// MediaLine is one recognised line with its quadrilateral in source pixels.
type MediaLine struct {
	Text   string       `json:"text"`
	Score  float64      `json:"score"`
	Box    [][2]float64 `json:"box"`
	Script string       `json:"script,omitempty"`
}

// Well-known kernel keys the driver plugins publish under.
const (
	keyMediaReader = "brain.media_reader"
	keyEmbedder = "brain.embedder"
	keyReranker = "brain.reranker"
	keyEngine   = "brain.engine"
)

// RegisterEmbedder/Reranker/Engine are called by driver plugins to publish their
// implementation onto the kernel. Exported from internal and re-exported by the
// root package so external plugins never import internal.
func RegisterEmbedder(k *togo.Kernel, e Embedder) { k.Set(keyEmbedder, e) }
func RegisterReranker(k *togo.Kernel, r Reranker) { k.Set(keyReranker, r) }
func RegisterEngine(k *togo.Kernel, e Engine)     { k.Set(keyEngine, e) }

// RegisterMediaReader publishes the media → text driver (brain-ocr).
func RegisterMediaReader(k *togo.Kernel, m MediaReader) { k.Set(keyMediaReader, m) }
