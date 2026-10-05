// Package brainocr is the media-reader plugin for Zekra: it publishes a
// MediaReader backed by the zekra-ocr service (infra/ocr) onto the kernel, so
// the brain can turn images, PDFs, video and audio into memory. Config from env
// (OCR_URL / OCR_TOKEN / OCR_TIMEOUT / OCR_LIVE_URL). Self-registers on blank-import.
package brainocr

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/togo-framework/togo"

	"github.com/togo-framework/brain"
)

const Name = "brain-ocr"

func init() {
	togo.RegisterProviderFunc(Name, togo.PriorityLate, func(k *togo.Kernel) error {
		base := strings.TrimRight(os.Getenv("OCR_URL"), "/")
		if base == "" {
			if k.Log != nil {
				k.Log.Warn("brain-ocr: OCR_URL unset — media reading disabled")
			}
			return nil
		}
		timeout := 30 * time.Minute
		if d, err := time.ParseDuration(os.Getenv("OCR_TIMEOUT")); err == nil && d > 0 {
			timeout = d
		}
		c := &Client{base: base, token: os.Getenv("OCR_TOKEN"), live: os.Getenv("OCR_LIVE_URL"), http: &http.Client{Timeout: timeout}}
		brain.RegisterMediaReader(k, c)
		if k.Log != nil {
			k.Log.Info("plugin active", "plugin", Name, "url", base)
		}
		return nil
	})
}

// Client talks to zekra-ocr.
type Client struct {
	base, token, live string
	http              *http.Client
}

type ocrLine struct {
	Text   string       `json:"text"`
	Score  float64      `json:"score"`
	Box    [][2]float64 `json:"box"`
	Script string       `json:"script"`
}

func toLines(in []ocrLine) []brain.MediaLine {
	out := make([]brain.MediaLine, 0, len(in))
	for _, l := range in {
		out = append(out, brain.MediaLine{Text: l.Text, Score: l.Score, Box: l.Box, Script: l.Script})
	}
	return out
}

type speech struct {
	Start, End float64
	Text       string
}

func (sp *speech) UnmarshalJSON(b []byte) error {
	var v struct {
		Start float64 `json:"start"`
		End   float64 `json:"end"`
		Text  string  `json:"text"`
	}
	err := json.Unmarshal(b, &v)
	sp.Start, sp.End, sp.Text = v.Start, v.End, v.Text
	return err
}

func speechSegs(in []speech) []brain.MediaSegment {
	out := make([]brain.MediaSegment, 0, len(in))
	for _, s := range in {
		st, en := s.Start, s.End
		out = append(out, brain.MediaSegment{Kind: "speech", Start: &st, End: &en, Text: s.Text})
	}
	return out
}

// ReadMedia sends the file to the endpoint for its kind and maps the answer.
func (c *Client) ReadMedia(ctx context.Context, kind, filename string, data []byte) (*brain.MediaText, error) {
	switch kind {
	case "image":
		var r struct {
			Width, Height int
			Lines         []ocrLine `json:"lines"`
			Text          string    `json:"text"`
		}
		if err := c.post(ctx, "/v1/ocr", filename, data, &r); err != nil {
			return nil, err
		}
		return &brain.MediaText{Width: r.Width, Height: r.Height, Segments: []brain.MediaSegment{
			{Kind: "image", Text: r.Text, Lines: toLines(r.Lines), Width: r.Width, Height: r.Height}}}, nil
	case "pdf":
		var r struct {
			Pages []struct {
				Page          int
				Text          string
				Lines         []ocrLine `json:"lines"`
				Width, Height int
			} `json:"pages"`
		}
		if err := c.post(ctx, "/v1/pdf", filename, data, &r); err != nil {
			return nil, err
		}
		out := &brain.MediaText{}
		for _, p := range r.Pages {
			out.Segments = append(out.Segments, brain.MediaSegment{Kind: "page", Page: p.Page, Text: p.Text,
				Lines: toLines(p.Lines), Width: p.Width, Height: p.Height})
		}
		return out, nil
	case "video":
		var r struct {
			Frames []struct {
				T     float64
				Text  string
				Lines []ocrLine `json:"lines"`
			} `json:"frames"`
			Speech   []speech `json:"speech"`
			Duration float64  `json:"duration"`
			Width    int      `json:"width"`
			Height   int      `json:"height"`
		}
		if err := c.post(ctx, "/v1/video?speech=1", filename, data, &r); err != nil {
			return nil, err
		}
		out := &brain.MediaText{Duration: r.Duration, Width: r.Width, Height: r.Height}
		for _, f := range r.Frames {
			t := f.T
			out.Segments = append(out.Segments, brain.MediaSegment{Kind: "frame", Start: &t, Text: f.Text, Lines: toLines(f.Lines)})
		}
		out.Segments = append(out.Segments, speechSegs(r.Speech)...)
		return out, nil
	case "audio":
		var r struct {
			Speech   []speech `json:"speech"`
			Duration float64  `json:"duration"`
		}
		if err := c.post(ctx, "/v1/audio", filename, data, &r); err != nil {
			return nil, err
		}
		return &brain.MediaText{Duration: r.Duration, Segments: speechSegs(r.Speech)}, nil
	}
	return nil, fmt.Errorf("brain-ocr: unsupported kind %q", kind)
}

// LiveURL is the reader's websocket endpoint, token included; the brain proxies
// browsers to it server-side so the token stays private.
func (c *Client) LiveURL() string {
	u := c.live
	if u == "" {
		u = c.base + "/v1/live"
		u = strings.Replace(strings.Replace(u, "https://", "wss://", 1), "http://", "ws://", 1)
	}
	if c.token != "" {
		sep := "?"
		if strings.Contains(u, "?") {
			sep = "&"
		}
		u += sep + "token=" + url.QueryEscape(c.token)
	}
	return u
}

func (c *Client) post(ctx context.Context, path, filename string, data []byte, out any) error {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, err := mw.CreateFormFile("file", filename)
	if err != nil {
		return err
	}
	if _, err := fw.Write(data); err != nil {
		return err
	}
	_ = mw.Close()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+path, &body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("brain-ocr: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("brain-ocr: %s: %s", resp.Status, strings.TrimSpace(string(msg)))
	}
	return json.NewDecoder(resp.Body).Decode(out)
}
