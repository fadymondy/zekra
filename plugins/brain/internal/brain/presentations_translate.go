package brain

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/togo-framework/brain/presentations"
)

/*
The presentation translator: ONE model call per translation, resolved from the
environment on every call (so configuring a key needs no restart).

 1. PRESENTATIONS_TRANSLATE=0 → none (ErrNoTranslator; MCP callers translate
    with their own model and store it with presentation_translate {content}).
 2. Anthropic messages API when PRESENTATIONS_TRANSLATE_ANTHROPIC_KEY,
    BRAIN_CHAT_ANTHROPIC_KEY or ANTHROPIC_API_KEY is set; model
    PRESENTATIONS_TRANSLATE_MODEL, else the brain chat's (BRAIN_CHAT_ANTHROPIC_MODEL).
 3. An OpenAI-compatible /v1/chat/completions endpoint:
    PRESENTATIONS_TRANSLATE_LLM_URL / _MODEL / _KEY, else the brain chat's
    BRAIN_CHAT_LLM_URL / EXTRACTION_LLM_URL (+ _MODEL, _KEY).
 4. Nothing configured → ErrNoTranslator.
*/

func envTranslator() presentations.Translator {
	return presentations.TranslatorFunc(func(ctx context.Context, system, user string) (string, string, string, error) {
		if strings.TrimSpace(os.Getenv("PRESENTATIONS_TRANSLATE")) == "0" {
			return "", "", "", presentations.ErrNoTranslator
		}
		if key := firstEnv("PRESENTATIONS_TRANSLATE_ANTHROPIC_KEY", "BRAIN_CHAT_ANTHROPIC_KEY", "ANTHROPIC_API_KEY"); key != "" {
			_, model, _ := chatAnthropic()
			if m := firstEnv("PRESENTATIONS_TRANSLATE_MODEL"); m != "" {
				model = m
			}
			text, err := anthropicComplete(ctx, key, model, system, user, 16000)
			return text, "anthropic", model, err
		}
		url := firstEnv("PRESENTATIONS_TRANSLATE_LLM_URL")
		model := firstEnv("PRESENTATIONS_TRANSLATE_LLM_MODEL", "PRESENTATIONS_TRANSLATE_MODEL")
		key := firstEnv("PRESENTATIONS_TRANSLATE_LLM_KEY")
		if url == "" {
			var ok bool
			var cm, ck string
			url, cm, ck, ok = chatLLM()
			if !ok {
				return "", "", "", presentations.ErrNoTranslator
			}
			if model == "" {
				model = cm
			}
			if key == "" {
				key = ck
			}
		}
		if model == "" {
			model = "llama3.1"
		}
		text, err := chatComplete(ctx, url, key, model, []map[string]string{
			{"role": "system", "content": system}, {"role": "user", "content": user}})
		return text, "openai-compatible", model, err
	})
}

// anthropicComplete is one plain (tool-less) messages call.
func anthropicComplete(ctx context.Context, key, model, system, user string, maxTokens int) (string, error) {
	body, _ := json.Marshal(map[string]any{
		"model": model, "max_tokens": maxTokens, "system": system,
		"messages": []map[string]string{{"role": "user", "content": user}},
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.anthropic.com/v1/messages", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", key)
	req.Header.Set("anthropic-version", "2023-06-01")
	resp, err := (&http.Client{Timeout: 5 * time.Minute}).Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var out struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}
	if resp.StatusCode >= 400 {
		if out.Error.Message != "" {
			return "", errors.New(out.Error.Message)
		}
		return "", fmt.Errorf("anthropic http %d", resp.StatusCode)
	}
	var b strings.Builder
	for _, c := range out.Content {
		if c.Type == "text" {
			b.WriteString(c.Text)
		}
	}
	return b.String(), nil
}
