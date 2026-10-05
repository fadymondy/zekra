package brain

import (
	"context"
	"strings"
	"testing"
)

func TestSniffMedia(t *testing.T) {
	png := []byte("\x89PNG\r\n\x1a\n0000000000000000")
	pdf := []byte("%PDF-1.7\n0000000000")
	m4a := append([]byte("\x00\x00\x00\x20ftypM4A "), make([]byte, 32)...)
	mov := append([]byte("\x00\x00\x00\x14ftypqt  "), make([]byte, 32)...)
	cases := []struct {
		name, declared, file string
		data                 []byte
		want                 string
	}{
		{"png", "", "a.png", png, "image/png"},
		{"pdf", "", "a.pdf", pdf, "application/pdf"},
		{"m4a is audio", "", "a.m4a", m4a, "audio/mp4"},
		{"mov by declared type", "video/quicktime", "a.mov", mov, "video/quicktime"},
		{"text is refused", "image/png", "a.png", []byte("hello world, not an image"), ""},
		{"html is refused", "", "a.html", []byte("<html><body>x</body></html>"), ""},
		{"unknown bytes cannot claim image", "image/png", "a.bin", make([]byte, 32), ""},
	}
	for _, c := range cases {
		if got := sniffMedia(c.data, c.declared, c.file); got != c.want {
			t.Errorf("%s: got %q want %q", c.name, got, c.want)
		}
	}
}

func TestMediaNoteBody(t *testing.T) {
	m := &Media{ID: "x", Kind: "video", Name: "talk [1].mp4", URL: "/api/media/x/file"}
	if b := mediaNoteBody(m, nil, "Reading…"); !strings.Contains(b, "_Reading…_") || !strings.Contains(b, `talk \[1\].mp4`) {
		t.Fatalf("pending body: %q", b)
	}
	t0, t1 := 65.0, 3725.0
	res := &MediaText{Segments: []MediaSegment{
		{Kind: "frame", Start: &t0, Text: "Agenda"},
		{Kind: "frame", Start: &t1, Text: "  "},
		{Kind: "speech", Start: &t1, Text: "مرحبا بكم"},
	}}
	b := mediaNoteBody(m, res, "")
	for _, want := range []string{"## Frame at 1:05\n\nAgenda", "## Transcript", "[1:02:05] مرحبا بكم"} {
		if !strings.Contains(b, want) {
			t.Errorf("body missing %q:\n%s", want, b)
		}
	}
	if strings.Count(b, "## Frame") != 1 {
		t.Errorf("empty frame should be skipped:\n%s", b)
	}
	img := &Media{Kind: "image", Name: "a.png", URL: "/u"}
	if b := mediaNoteBody(img, &MediaText{}, ""); !strings.HasPrefix(b, "![a.png](/u)") || !strings.Contains(b, "No text found") {
		t.Errorf("image body: %q", b)
	}
}

func TestFetchPublicRefusesInternal(t *testing.T) {
	for _, u := range []string{"http://127.0.0.1:1/x", "http://10.0.0.1/x", "http://[::1]/x", "file:///etc/passwd", "ftp://example.com/x"} {
		if _, _, _, err := fetchPublic(context.Background(), u, 1<<20); err == nil {
			t.Errorf("%s: expected refusal", u)
		}
	}
}
