package presentations

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"time"
)

/*
Translating a document to its other language (FM-342, ported).

On fadymondy.com this used the site's internal/ai layer (the "draft" task,
AI_TASK_DRAFT). In Zekra the model is whatever Translator the brain plugin
installs (internal/brain/presentations_translate.go): the Anthropic messages
API when PRESENTATIONS_TRANSLATE_ANTHROPIC_KEY / BRAIN_CHAT_ANTHROPIC_KEY /
ANTHROPIC_API_KEY is set, else the OpenAI-compatible chat endpoint the brain
chat uses (BRAIN_CHAT_LLM_URL / EXTRACTION_LLM_URL). ONE call per translation.
With none configured it fails with ErrNoTranslator, and the MCP path is the
fallback: the calling model translates and stores the result with
presentation_update {locale, content} (or presentation_translate {content}).

The model sees and returns the content JSON. Its answer is only accepted if it
has the same shape and every structural value (types, URLs, ids, code, scene
params, chart numbers) is unchanged; then it goes through the same validator
as hand-written content.
*/

// Translator is one model call: a system prompt and the user message in, the
// model's text out, with provenance.
type Translator interface {
	Generate(ctx context.Context, system, user string) (text, provider, model string, err error)
}

// TranslatorFunc adapts a function to Translator.
type TranslatorFunc func(ctx context.Context, system, user string) (string, string, string, error)

// Generate calls f.
func (f TranslatorFunc) Generate(ctx context.Context, system, user string) (string, string, string, error) {
	return f(ctx, system, user)
}

// ErrNoTranslator means no model can serve translation here.
var ErrNoTranslator = errors.New(`no translation model is configured on this server; translate with your own model and store it with presentation_update {locale, content}`)

// fixedKeys are never translated.
var fixedKeys = map[string]bool{
	"type": true, "image_url": true, "url": true, "cta_href": true, "document_id": true, "code": true,
	"language": true, "scene": true, "chart": true, "tone": true, "trend": true, "height": true,
	"values": true, "highlighted": true, "icon": true,
	// FM-350 structure: ids, references, enums and flags.
	"id": true, "from": true, "to": true, "highlight": true, "layout": true, "kind": true, "frame": true,
	"target_part_index": true, "build": true, "transition": true, "active": true, "state": true,
}

const translateSystem = `You translate structured presentation content for a software consultancy.
Translate every human-readable string value from {from} to {to}. Keep the JSON structure identical:
the same keys, the same array lengths and order. Do NOT translate or change the values of these keys:
type, image_url, url, cta_href, document_id, code, language, scene, chart, tone, trend, height, values,
highlighted, icon, id, from, to, highlight, layout, kind, frame, target_part_index, build, transition, active, state.
Keep numbers, prices, product names, brand names and markdown syntax as they are.
Arabic must be natural Modern Standard Arabic suitable for business clients.
Answer with the translated JSON object only, no prose, no code fences.`

// sameShape reports the first structural difference between a and b.
func sameShape(path string, a, b any) error {
	switch av := a.(type) {
	case map[string]any:
		bv, ok := b.(map[string]any)
		if !ok || len(av) != len(bv) {
			return fmt.Errorf("%s: the object changed shape", path)
		}
		for k, x := range av {
			y, ok := bv[k]
			if !ok {
				return fmt.Errorf("%s.%s: missing", path, k)
			}
			if fixedKeys[k] {
				if !reflect.DeepEqual(x, y) {
					return fmt.Errorf("%s.%s: must not change", path, k)
				}
				continue
			}
			if err := sameShape(path+"."+k, x, y); err != nil {
				return err
			}
		}
	case []any:
		bv, ok := b.([]any)
		if !ok || len(av) != len(bv) {
			return fmt.Errorf("%s: the list changed length", path)
		}
		for i := range av {
			if err := sameShape(fmt.Sprintf("%s[%d]", path, i), av[i], bv[i]); err != nil {
				return err
			}
		}
	case string:
		if _, ok := b.(string); !ok {
			return fmt.Errorf("%s: must stay a string", path)
		}
	default:
		if !reflect.DeepEqual(a, b) {
			return fmt.Errorf("%s: must not change", path)
		}
	}
	return nil
}

func stripFences(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "```") {
		s = strings.TrimPrefix(s, "```json")
		s = strings.TrimPrefix(s, "```")
		s = strings.TrimSuffix(strings.TrimSpace(s), "```")
	}
	return strings.TrimSpace(s)
}

// Translate fills the other locale (or `to`) from the document's primary
// content with the configured model.
func (s *Store) Translate(ctx context.Context, id, to string) (*Presentation, error) {
	doc, err := s.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	from := doc.Locale
	if to == "" {
		to = OtherLocale(from)
	}
	if !IsLocale(to) {
		return nil, InvalidError{"to must be en or ar"}
	}
	if to == from {
		// Translate from whichever locale is not the target.
		from = OtherLocale(to)
	}
	src, ok := doc.Content[from]
	if !ok {
		return nil, InvalidError{"there is no " + from + " content to translate from"}
	}
	if s.Translator == nil {
		return nil, ErrNoTranslator
	}
	body, _ := json.Marshal(src)
	names := map[string]string{"en": "English", "ar": "Arabic"}
	sys := strings.NewReplacer("{from}", names[from], "{to}", names[to]).Replace(translateSystem)
	text, provider, model, err := s.Translator.Generate(ctx, sys, string(body))
	if err != nil {
		if errors.Is(err, ErrNoTranslator) {
			return nil, ErrNoTranslator
		}
		return nil, fmt.Errorf("the model could not translate: %w", err)
	}
	var out map[string]any
	if err := json.Unmarshal([]byte(stripFences(text)), &out); err != nil {
		return nil, fmt.Errorf("the model's translation is not JSON: %w", err)
	}
	var norm any
	_ = json.Unmarshal(body, &norm)
	if err := sameShape("content", norm, out); err != nil {
		return nil, fmt.Errorf("the model's translation changed the structure (%v); nothing was stored", err)
	}
	return s.SetTranslation(ctx, doc.ID, to, out, map[string]any{
		"from": from, "by": "ai", "provider": provider, "model": model,
		"at": time.Now().UTC().Format(time.RFC3339),
	})
}
