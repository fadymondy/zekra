package brain

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/togo-framework/togo"
)

/*
Contradiction detection (docs/ux/ZEKRA-CAPABILITY-GAPS.md S12).

The write decision (writedecision.go) only ever compares a new memory with its
single nearest neighbour, and only by similarity: "the deploy runs on Fridays"
and "the deploy runs on Mondays" are a near-duplicate to it, so the second one
silently superseded the first, and two contradicting facts that are a little less
alike were simply both kept, with nothing saying they disagree.

Now, on retain (except NOOP and source_ref imports, which are identities, not
claims), the brain:

 1. takes the top-k nearest VALID memories in the brain (conflictTopK);
 2. pre-filters them cheaply: similar enough to be about the same thing
    (conflictMinSim ≤ sim < simDuplicate) and sharing content words;
 3. asks a judge whether each survivor contradicts the new text. The judge is an
    LLM answering a strict JSON schema when one is configured, otherwise a
    heuristic (negation polarity / differing numbers about the same subject);
 4. RECORDS each contradiction in memory_conflicts — never by silently dropping
    either fact.

What happens to the two memories:

  - an explicit negation of a near-identical memory ("X is no longer true")
    retires it as before (INVALIDATE) and the conflict is recorded as
    resolved_keep_new (detector "negation");
  - an UPDATE whose target the judge confirms as contradicting, written by the
    same author from the same source (a self-correction), proceeds and is
    recorded resolved_keep_new;
  - the same, but from a different author or source with a confident verdict
    (≥ conflictFlipConfidence), is NOT allowed to overwrite: the decision becomes
    ADD, both memories stay valid and the conflict is open;
  - any other contradicting neighbour → both kept, conflict open.

Open conflicts surface in recall (per-result "conflicts"), in
GET /api/brain/conflicts and the list_conflicts / resolve_conflict MCP tools.
The credibility rule (conflictCredibility) names a preferred side so a reader
has a default; recall ranks the less credible side below the preferred one.
*/

const (
	conflictTopK           = 5
	conflictMaxJudged      = 3
	conflictFlipConfidence = 0.7
	conflictMinConfidence  = 0.5
)

// Conflict statuses.
const (
	ConflictOpen     = "open"
	ConflictKeepNew  = "resolved_keep_new"
	ConflictKeepOld  = "resolved_keep_old"
	ConflictScoped   = "both_valid_scoped"
	keyConflictJudge = "brain.conflict_judge"
)

// ConflictVerdict is the judge's answer — the strict JSON schema the LLM fills.
type ConflictVerdict struct {
	Contradicts bool    `json:"contradicts"`
	Kind        string  `json:"kind"` // factual | temporal | numeric | negation | preference
	Reason      string  `json:"reason"`
	Confidence  float64 `json:"confidence"`
	Scoped      bool    `json:"scoped"` // both can hold in different scopes / contexts
}

// ConflictJudge decides whether an incoming memory contradicts an existing one.
type ConflictJudge interface {
	Judge(ctx context.Context, existing, incoming string) (*ConflictVerdict, error)
}

// RegisterConflictJudge plugs a judge in (a provider plugin, or a test). It wins
// over the env-configured LLM / heuristic.
func RegisterConflictJudge(k *togo.Kernel, j ConflictJudge) { k.Set(keyConflictJudge, j) }

// conflictMode is BRAIN_CONFLICT_DETECT: off | heuristic | llm | "" (auto: LLM
// when one is configured, else the heuristic).
func conflictMode() string {
	return strings.ToLower(strings.TrimSpace(os.Getenv("BRAIN_CONFLICT_DETECT")))
}

// conflictMinSim is the similarity floor below which two memories are taken to be
// about different things (BRAIN_CONFLICT_MIN_SIM, default 0.72).
func conflictMinSim() float64 {
	if v, err := strconv.ParseFloat(strings.TrimSpace(os.Getenv("BRAIN_CONFLICT_MIN_SIM")), 64); err == nil && v > 0 && v < 1 {
		return v
	}
	return 0.72
}

// conflictTimeout bounds the whole detection step on a retain
// (BRAIN_CONFLICT_TIMEOUT, a Go duration; default 5s). Past it the write goes
// ahead without the verdicts still pending — detection fails open.
func conflictTimeout() time.Duration {
	if d, err := time.ParseDuration(strings.TrimSpace(os.Getenv("BRAIN_CONFLICT_TIMEOUT"))); err == nil && d > 0 {
		return d
	}
	return 5 * time.Second
}

// conflictJudge returns the judge in effect and its detector label.
func (s *Store) conflictJudge() (ConflictJudge, string) {
	mode := conflictMode()
	if mode == "off" || mode == "0" || mode == "false" {
		return nil, ""
	}
	if v, ok := s.k.Get(keyConflictJudge); ok {
		if j, ok := v.(ConflictJudge); ok && j != nil {
			return j, "llm"
		}
	}
	if mode != "heuristic" {
		if j := llmJudgeFromEnv(); j != nil {
			return j, "llm"
		}
	}
	return heuristicJudge{}, "heuristic"
}

// --- pre-filter -------------------------------------------------------------------

var conflictStopwords = map[string]bool{
	"the": true, "and": true, "for": true, "are": true, "was": true, "were": true, "with": true,
	"that": true, "this": true, "from": true, "has": true, "have": true, "had": true, "but": true,
	"our": true, "its": true, "now": true, "will": true, "they": true, "them": true, "their": true,
	"into": true, "onto": true, "than": true, "then": true, "there": true, "which": true, "what": true,
	"في": true, "من": true, "على": true, "إلى": true, "عن": true, "مع": true, "هذا": true, "هذه": true,
}

// contentWords are the lower-cased words of ≥3 letters (any script) minus a short
// stopword list, plus every token that carries a digit.
func contentWords(s string) map[string]bool {
	out := map[string]bool{}
	for _, f := range strings.FieldsFunc(strings.ToLower(s), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '.'
	}) {
		f = strings.Trim(f, ".")
		hasDigit := strings.IndexFunc(f, unicode.IsDigit) >= 0
		if (len([]rune(f)) >= 3 || hasDigit) && !conflictStopwords[f] {
			out[f] = true
		}
	}
	return out
}

func numbersOf(words map[string]bool) map[string]bool {
	out := map[string]bool{}
	for w := range words {
		if strings.IndexFunc(w, unicode.IsDigit) >= 0 {
			out[w] = true
		}
	}
	return out
}

// lexicalOverlap is the Jaccard overlap of the two texts' content words.
func lexicalOverlap(a, b string) float64 {
	wa, wb := contentWords(a), contentWords(b)
	if len(wa) == 0 || len(wb) == 0 {
		return 0
	}
	inter := 0
	for w := range wa {
		if wb[w] {
			inter++
		}
	}
	return float64(inter) / float64(len(wa)+len(wb)-inter)
}

// conflictCandidate is the cheap pre-filter: close enough to be about the same
// subject, not a duplicate, and sharing content words.
func conflictCandidate(n neighbor, incoming string, minSim float64) bool {
	if n.Sim < minSim || n.Sim >= simDuplicate {
		return false
	}
	if normText(n.Content) == normText(incoming) {
		return false
	}
	return lexicalOverlap(n.Content, incoming) >= 0.2
}

// --- heuristic judge --------------------------------------------------------------

var polarityWords = map[string]bool{
	"not": true, "no": true, "never": true, "none": true, "cannot": true, "nor": true,
	"لا": true, "ليس": true, "ليست": true, "لم": true, "لن": true, "غير": true,
}

// negated reports whether the text carries a negation (a polarity word, an n't
// contraction or one of the write-decision retraction cues).
func negated(s string) bool {
	if negates(s) {
		return true
	}
	for _, f := range strings.FieldsFunc(strings.ToLower(s), func(r rune) bool {
		return !unicode.IsLetter(r) && r != '\'' && r != '’'
	}) {
		if polarityWords[f] || strings.HasSuffix(f, "n't") || strings.HasSuffix(f, "n’t") {
			return true
		}
	}
	return false
}

// heuristicJudge is the no-LLM judge: a flipped polarity, or different numbers
// about the same subject. Deliberately low-confidence, so it records a conflict
// for a person to look at but never overrules the write decision.
type heuristicJudge struct{}

func (heuristicJudge) Judge(_ context.Context, existing, incoming string) (*ConflictVerdict, error) {
	if negated(existing) != negated(incoming) {
		return &ConflictVerdict{Contradicts: true, Kind: "negation", Confidence: 0.55,
			Reason: "one statement negates the other"}, nil
	}
	ne, ni := numbersOf(contentWords(existing)), numbersOf(contentWords(incoming))
	if len(ne) > 0 && len(ni) > 0 && lexicalOverlap(existing, incoming) >= 0.3 {
		same := len(ne) == len(ni)
		for n := range ne {
			if !ni[n] {
				same = false
			}
		}
		if !same {
			return &ConflictVerdict{Contradicts: true, Kind: "numeric", Confidence: 0.5,
				Reason: "the same subject with different numbers"}, nil
		}
	}
	return &ConflictVerdict{Contradicts: false}, nil
}

// --- LLM judge --------------------------------------------------------------------

// llmJudge asks an OpenAI-compatible /v1/chat/completions endpoint with a strict
// JSON-schema response format. Any malformed answer is an error (fail open).
type llmJudge struct {
	url, model, key string
	client          *http.Client
}

// llmJudgeFromEnv uses BRAIN_CONFLICT_LLM_URL/_MODEL/_KEY, falling back to the
// chat / extraction LLM. nil when no LLM is configured.
func llmJudgeFromEnv() *llmJudge {
	url, model, key := firstEnv("BRAIN_CONFLICT_LLM_URL"), firstEnv("BRAIN_CONFLICT_LLM_MODEL"), firstEnv("BRAIN_CONFLICT_LLM_KEY")
	if url == "" {
		var ok bool
		if url, model, key, ok = chatLLM(); !ok {
			return nil
		}
	}
	if model == "" {
		model = "llama3.1"
	}
	return &llmJudge{url: url, model: model, key: key, client: &http.Client{Timeout: 30 * time.Second}}
}

const conflictSystemPrompt = `You check two memories stored by an AI memory system for contradiction.
A contradiction means both cannot be true at the same time about the same subject
(a changed fact, a different number, a negation, an incompatible preference).
Statements that only add detail, or talk about different subjects, do NOT contradict.
If both could be true in different scopes (different projects, people, environments
or time periods) set scoped=true. Answer ONLY with the JSON object.`

var conflictSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"contradicts": map[string]any{"type": "boolean"},
		"kind":        map[string]any{"type": "string", "enum": []string{"factual", "temporal", "numeric", "negation", "preference", "none"}},
		"reason":      map[string]any{"type": "string"},
		"confidence":  map[string]any{"type": "number"},
		"scoped":      map[string]any{"type": "boolean"},
	},
	"required":             []string{"contradicts", "kind", "reason", "confidence", "scoped"},
	"additionalProperties": false,
}

func (j *llmJudge) Judge(ctx context.Context, existing, incoming string) (*ConflictVerdict, error) {
	body, _ := json.Marshal(map[string]any{
		"model": j.model,
		"messages": []map[string]string{
			{"role": "system", "content": conflictSystemPrompt},
			{"role": "user", "content": "EXISTING memory:\n" + clipRunes(existing, 2000) + "\n\nNEW memory:\n" + clipRunes(incoming, 2000)},
		},
		"temperature": 0,
		"stream":      false,
		"response_format": map[string]any{
			"type":        "json_schema",
			"json_schema": map[string]any{"name": "conflict_verdict", "strict": true, "schema": conflictSchema},
		},
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(j.url, "/")+"/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if j.key != "" {
		req.Header.Set("Authorization", "Bearer "+j.key)
	}
	resp, err := j.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("conflict judge: llm http %d", resp.StatusCode)
	}
	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	if len(out.Choices) == 0 {
		return nil, errors.New("conflict judge: no choices")
	}
	return parseVerdict(out.Choices[0].Message.Content)
}

// parseVerdict decodes and validates a verdict. Code fences are tolerated; a
// missing required field or a wrong type is an error.
func parseVerdict(raw string) (*ConflictVerdict, error) {
	raw = strings.TrimSpace(raw)
	raw = strings.TrimPrefix(raw, "```json")
	raw = strings.TrimPrefix(raw, "```")
	raw = strings.TrimSuffix(strings.TrimSpace(raw), "```")
	var probe map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &probe); err != nil {
		return nil, fmt.Errorf("conflict judge: not JSON: %w", err)
	}
	for _, k := range []string{"contradicts", "confidence"} {
		if _, ok := probe[k]; !ok {
			return nil, fmt.Errorf("conflict judge: missing %q", k)
		}
	}
	var v ConflictVerdict
	if err := json.Unmarshal([]byte(raw), &v); err != nil {
		return nil, fmt.Errorf("conflict judge: %w", err)
	}
	if math.IsNaN(v.Confidence) {
		v.Confidence = 0
	}
	v.Confidence = math.Max(0, math.Min(1, v.Confidence))
	switch v.Kind {
	case "factual", "temporal", "numeric", "negation", "preference":
	default:
		v.Kind = "factual"
	}
	v.Reason = clipRunes(strings.TrimSpace(v.Reason), 300)
	return &v, nil
}

// --- credibility ------------------------------------------------------------------

// memFacts is what the credibility rule looks at.
type memFacts struct {
	ID         string
	SourceKind string
	Owner      string
	Importance float64
	ValidAt    time.Time
}

// sourceWeight ranks where a memory came from: a person writing it by hand beats a
// curated note, which beats a connector import, which beats an agent's own
// write, which beats a chat-derived memory.
func sourceWeight(kind string) float64 {
	k := strings.ToLower(kind)
	switch {
	case k == "manual" || k == "console" || k == "user":
		return 1.0
	case k == "note" || k == "media":
		return 0.9
	case k == "datasource" || strings.HasPrefix(k, "github") || strings.HasPrefix(k, "flowos") ||
		k == "slack" || k == "whatsapp" || k == "import":
		return 0.8
	case k == "claude_code" || k == "coder_run" || k == "mcp" || k == "agent" || strings.HasPrefix(k, "agent"):
		return 0.6
	case k == "chat":
		return 0.4
	default:
		return 0.5
	}
}

// conflictCredibility scores one side:
//
//	score = 0.40·recency + 0.35·source + 0.25·importance
//	recency = 1 / (1 + age_days/30)   (valid_at; a month old ≈ 0.5)
//
// The higher score is the preferred side; a tie (|Δ| < 0.01) goes to the newer
// memory. It is a default for readers, never an automatic deletion.
func conflictCredibility(m memFacts, now time.Time) map[string]float64 {
	age := now.Sub(m.ValidAt).Hours() / 24
	if age < 0 {
		age = 0
	}
	rec := 1 / (1 + age/30)
	src := sourceWeight(m.SourceKind)
	imp := math.Max(0, math.Min(1, m.Importance))
	score := 0.40*rec + 0.35*src + 0.25*imp
	round := func(f float64) float64 { return math.Round(f*1000) / 1000 }
	return map[string]float64{"recency": round(rec), "source": round(src), "importance": round(imp), "score": round(score)}
}

// preferredOf returns the preferred memory id and the credibility breakdown.
func preferredOf(a, b memFacts, now time.Time) (string, map[string]any) {
	ca, cb := conflictCredibility(a, now), conflictCredibility(b, now)
	pref := b.ID
	switch d := ca["score"] - cb["score"]; {
	case d >= 0.01:
		pref = a.ID
	case d <= -0.01:
		pref = b.ID
	default:
		if a.ValidAt.After(b.ValidAt) {
			pref = a.ID
		}
	}
	return pref, map[string]any{
		"a": ca, "b": cb,
		"rule": "score = 0.40*recency + 0.35*source + 0.25*importance; tie -> newer",
	}
}

// --- detection on retain ----------------------------------------------------------

// foundConflict is a contradiction detected before the new row exists.
type foundConflict struct {
	n        neighbor
	verdict  ConflictVerdict
	detector string
	status   string
	retire   bool // the existing memory is retired by this write (negation / update)
}

// detectConflicts judges the neighbours of a pending write. It may turn an UPDATE
// into an ADD (a confident contradiction from another author must not silently
// overwrite). Returns the possibly-changed decision/relatedID and the conflicts
// to record once the new row exists.
func (s *Store) detectConflicts(ctx context.Context, neigh []neighbor, in MemoryInput, decision, relatedID string) (string, string, []foundConflict) {
	if decision == "noop" || len(neigh) == 0 {
		return decision, relatedID, nil
	}
	var found []foundConflict
	if decision == "invalidate" {
		for _, n := range neigh {
			if n.ID == relatedID {
				found = append(found, foundConflict{n: n, detector: "negation", status: ConflictKeepNew, retire: true,
					verdict: ConflictVerdict{Contradicts: true, Kind: "negation", Confidence: 1,
						Reason: "the new memory explicitly retracts this one"}})
			}
		}
	}
	judge, detector := s.conflictJudge()
	if judge == nil {
		return decision, relatedID, found
	}
	minSim := conflictMinSim()
	var cands []neighbor
	for _, n := range neigh {
		if decision == "invalidate" && n.ID == relatedID {
			continue
		}
		if conflictCandidate(n, in.Content, minSim) {
			cands = append(cands, n)
			if len(cands) == conflictMaxJudged {
				break
			}
		}
	}
	if len(cands) == 0 {
		return decision, relatedID, found
	}
	jctx, cancel := context.WithTimeout(ctx, conflictTimeout())
	defer cancel()
	verdicts := make([]*ConflictVerdict, len(cands))
	var wg sync.WaitGroup
	for i, n := range cands {
		wg.Add(1)
		go func(i int, n neighbor) {
			defer wg.Done()
			if v, err := judge.Judge(jctx, n.Content, in.Content); err == nil && v != nil {
				verdicts[i] = v
			}
		}(i, n)
	}
	wg.Wait()
	for i, n := range cands {
		v := verdicts[i]
		if v == nil || !v.Contradicts || v.Confidence < conflictMinConfidence {
			continue
		}
		fc := foundConflict{n: n, verdict: *v, detector: detector, status: ConflictOpen}
		if v.Scoped {
			fc.status = ConflictScoped
		}
		if decision == "update" && n.ID == relatedID {
			if sameAuthor(n, in) || v.Confidence < conflictFlipConfidence || v.Scoped {
				// A self-correction (or a low-confidence verdict): the update stands.
				fc.status, fc.retire = ConflictKeepNew, true
			} else {
				// Another author contradicts this memory: keep both.
				decision, relatedID = "add", ""
			}
		}
		found = append(found, fc)
	}
	return decision, relatedID, found
}

// sameAuthor reports whether the incoming write comes from whoever wrote the
// existing memory. The owner agent decides when both sides have one; otherwise the
// source kind does. Plain retains are stored as note chunks (source_kind "note"),
// so "note" matches any kind.
func sameAuthor(n neighbor, in MemoryInput) bool {
	if n.Owner != "" && in.OwnerAgentID != "" {
		return n.Owner == in.OwnerAgentID
	}
	if n.Owner != in.OwnerAgentID {
		return false
	}
	return n.SourceKind == in.SourceKind || n.SourceKind == "note" || in.SourceKind == "note"
}

// recordConflicts writes the detected conflicts against the new memory id and
// returns them as refs for the retain result.
func (s *Store) recordConflicts(ctx context.Context, db *sql.DB, in MemoryInput, newID string, imp float64, found []foundConflict) []ConflictRef {
	if len(found) == 0 || newID == "" {
		return nil
	}
	validAt := time.Now()
	if in.ValidAt != nil && !in.ValidAt.IsZero() {
		validAt = *in.ValidAt
	}
	incoming := memFacts{ID: newID, SourceKind: in.SourceKind, Owner: in.OwnerAgentID, Importance: imp, ValidAt: validAt}
	var refs []ConflictRef
	for _, fc := range found {
		if fc.n.ID == newID {
			continue
		}
		existing := memFacts{ID: fc.n.ID, SourceKind: fc.n.SourceKind, Owner: fc.n.Owner, Importance: fc.n.Importance, ValidAt: fc.n.ValidAt}
		pref, cred := preferredOf(existing, incoming, time.Now())
		if fc.status == ConflictKeepNew {
			pref = newID
		}
		id, err := s.insertConflict(ctx, db, in.Namespace, existing.ID, newID, fc.verdict, fc.detector, fc.status, pref, cred)
		if err != nil {
			continue
		}
		if fc.retire {
			_, _ = db.ExecContext(ctx, `UPDATE memories SET metadata = metadata || jsonb_build_object('invalidated_by_conflict', $2::text)
				WHERE id = $1 AND invalid_at IS NOT NULL`, existing.ID, id)
		}
		refs = append(refs, ConflictRef{ID: id, With: existing.ID, Status: fc.status, Kind: fc.verdict.Kind,
			Reason: fc.verdict.Reason, Preferred: pref, Detector: fc.detector})
		s.eventMeta(ctx, db, "conflict", in.Namespace, "", fc.status, newID, 0, map[string]any{
			"conflict": id, "with": existing.ID, "kind": fc.verdict.Kind, "detector": fc.detector})
	}
	return refs
}

func (s *Store) insertConflict(ctx context.Context, db *sql.DB, ns, a, b string, v ConflictVerdict, detector, status, pref string, cred map[string]any) (string, error) {
	raw, _ := json.Marshal(cred)
	var resolvedAt any
	if status == ConflictKeepNew || status == ConflictKeepOld {
		resolvedAt = time.Now()
	}
	var id string
	err := db.QueryRowContext(ctx, `
		INSERT INTO memory_conflicts (namespace, memory_a, memory_b, kind, reason, confidence, detector,
		                              status, preferred_id, credibility, detected_by, resolved_at, resolved_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULLIF($9,'')::uuid,$10::jsonb,NULLIF($11,''),$12,
		        CASE WHEN $12::timestamptz IS NULL THEN NULL ELSE 'auto' END)
		ON CONFLICT (memory_a, memory_b) DO UPDATE
		   SET reason = EXCLUDED.reason, kind = EXCLUDED.kind, confidence = EXCLUDED.confidence
		RETURNING id::text`,
		ns, a, b, v.Kind, v.Reason, v.Confidence, detector, status, pref, string(raw),
		activityFrom(ctx).Agent, resolvedAt).Scan(&id)
	return id, err
}

// --- recall surface ---------------------------------------------------------------

// ConflictRef is a conflict as seen from one memory (retain / recall results).
type ConflictRef struct {
	ID        string `json:"id"`
	With      string `json:"with"` // the other memory
	Status    string `json:"status"`
	Kind      string `json:"kind,omitempty"`
	Reason    string `json:"reason,omitempty"`
	Preferred string `json:"preferred,omitempty"` // the credibility winner's id
	Detector  string `json:"detector,omitempty"`
}

// attachConflicts tags recall results with their unresolved conflicts (open or
// scoped, both sides still valid) and ranks the less credible side of an open
// conflict directly below the preferred one when both came back.
func (s *Store) attachConflicts(ctx context.Context, db *sql.DB, pool []Recalled) []Recalled {
	if len(pool) == 0 {
		return pool
	}
	ids := make([]string, len(pool))
	idx := make(map[string]int, len(pool))
	for i, r := range pool {
		ids[i] = r.ID
		idx[r.ID] = i
	}
	rows, err := db.QueryContext(ctx, `
		SELECT c.id::text, c.memory_a::text, c.memory_b::text, c.status, c.kind, c.reason,
		       COALESCE(c.preferred_id::text,''), c.detector
		FROM memory_conflicts c
		WHERE c.status IN ('open','both_valid_scoped')
		  AND (c.memory_a = ANY(string_to_array($1, ',')::uuid[]) OR c.memory_b = ANY(string_to_array($1, ',')::uuid[]))
		  AND EXISTS (SELECT 1 FROM memories m WHERE m.id = c.memory_a AND m.invalid_at IS NULL)
		  AND EXISTS (SELECT 1 FROM memories m WHERE m.id = c.memory_b AND m.invalid_at IS NULL)
		ORDER BY c.created_at`, strings.Join(ids, ","))
	if err != nil {
		return pool
	}
	defer rows.Close()
	type pair struct{ winner, loser string }
	var demote []pair
	for rows.Next() {
		var id, a, b, st, kind, reason, pref, det string
		if rows.Scan(&id, &a, &b, &st, &kind, &reason, &pref, &det) != nil {
			continue
		}
		if i, ok := idx[a]; ok {
			pool[i].Conflicts = append(pool[i].Conflicts, ConflictRef{ID: id, With: b, Status: st, Kind: kind, Reason: reason, Preferred: pref, Detector: det})
		}
		if i, ok := idx[b]; ok {
			pool[i].Conflicts = append(pool[i].Conflicts, ConflictRef{ID: id, With: a, Status: st, Kind: kind, Reason: reason, Preferred: pref, Detector: det})
		}
		if st == ConflictOpen && pref != "" {
			loser := a
			if pref == a {
				loser = b
			}
			demote = append(demote, pair{pref, loser})
		}
	}
	for _, p := range demote {
		wi, wok := -1, false
		li, lok := -1, false
		for i, r := range pool {
			if r.ID == p.winner {
				wi, wok = i, true
			}
			if r.ID == p.loser {
				li, lok = i, true
			}
		}
		if !wok || !lok || li > wi {
			continue
		}
		loser := pool[li]
		pool = append(pool[:li], pool[li+1:]...)
		wi-- // the winner shifted left
		pool = append(pool[:wi+1], append([]Recalled{loser}, pool[wi+1:]...)...)
	}
	return pool
}

// conflictsOf collects the distinct conflicts referenced by recall results.
func conflictsOf(rs []Recalled) []ConflictRef {
	seen := map[string]bool{}
	out := []ConflictRef{}
	for _, r := range rs {
		for _, c := range r.Conflicts {
			if seen[c.ID] {
				continue
			}
			seen[c.ID] = true
			cc := c
			cc.With = "" // top-level entries name both sides instead
			out = append(out, cc)
		}
	}
	return out
}

// --- list / resolve ---------------------------------------------------------------

// ConflictSide is one memory of a conflict, as listed.
type ConflictSide struct {
	ID         string     `json:"id"`
	Content    string     `json:"content"`
	SourceKind string     `json:"sourceKind,omitempty"`
	Owner      string     `json:"ownerAgentId,omitempty"`
	Importance float64    `json:"importance"`
	ValidAt    time.Time  `json:"validAt"`
	InvalidAt  *time.Time `json:"invalidAt,omitempty"`
}

// Conflict is a memory_conflicts row with both memories.
type Conflict struct {
	ID             string         `json:"id"`
	Namespace      string         `json:"namespace"`
	Status         string         `json:"status"`
	Kind           string         `json:"kind"`
	Reason         string         `json:"reason"`
	Confidence     float64        `json:"confidence"`
	Detector       string         `json:"detector"`
	PreferredID    string         `json:"preferredId,omitempty"`
	Credibility    map[string]any `json:"credibility,omitempty"`
	DetectedBy     string         `json:"detectedBy,omitempty"`
	ResolutionNote string         `json:"resolutionNote,omitempty"`
	ResolvedBy     string         `json:"resolvedBy,omitempty"`
	ResolvedAt     *time.Time     `json:"resolvedAt,omitempty"`
	CreatedAt      time.Time      `json:"createdAt"`
	A              *ConflictSide  `json:"a"` // the memory that was there first
	B              *ConflictSide  `json:"b"` // the write that raised the conflict
}

const conflictSelect = `
	SELECT c.id::text, c.namespace, c.status, c.kind, c.reason, c.confidence, c.detector,
	       COALESCE(c.preferred_id::text,''), c.credibility, COALESCE(c.detected_by,''),
	       COALESCE(c.resolution_note,''), COALESCE(c.resolved_by,''), c.resolved_at, c.created_at,
	       c.memory_a::text, COALESCE(ma.content,''), COALESCE(ma.source_kind,''), COALESCE(ma.owner_agent_id,''),
	       COALESCE(ma.importance,0), COALESCE(ma.valid_at, c.created_at), ma.invalid_at,
	       c.memory_b::text, COALESCE(mb.content,''), COALESCE(mb.source_kind,''), COALESCE(mb.owner_agent_id,''),
	       COALESCE(mb.importance,0), COALESCE(mb.valid_at, c.created_at), mb.invalid_at
	FROM memory_conflicts c
	LEFT JOIN LATERAL (SELECT * FROM memories WHERE id = c.memory_a ORDER BY valid_at DESC LIMIT 1) ma ON true
	LEFT JOIN LATERAL (SELECT * FROM memories WHERE id = c.memory_b ORDER BY valid_at DESC LIMIT 1) mb ON true`

func scanConflict(sc interface{ Scan(...any) error }) (*Conflict, error) {
	var c Conflict
	var a, b ConflictSide
	var cred []byte
	var resolvedAt, aInv, bInv sql.NullTime
	if err := sc.Scan(&c.ID, &c.Namespace, &c.Status, &c.Kind, &c.Reason, &c.Confidence, &c.Detector,
		&c.PreferredID, &cred, &c.DetectedBy, &c.ResolutionNote, &c.ResolvedBy, &resolvedAt, &c.CreatedAt,
		&a.ID, &a.Content, &a.SourceKind, &a.Owner, &a.Importance, &a.ValidAt, &aInv,
		&b.ID, &b.Content, &b.SourceKind, &b.Owner, &b.Importance, &b.ValidAt, &bInv); err != nil {
		return nil, err
	}
	c.Credibility = decodeJSONMap(cred)
	if resolvedAt.Valid {
		c.ResolvedAt = &resolvedAt.Time
	}
	if aInv.Valid {
		a.InvalidAt = &aInv.Time
	}
	if bInv.Valid {
		b.InvalidAt = &bInv.Time
	}
	c.A, c.B = &a, &b
	return &c, nil
}

// Conflicts lists conflicts. status "" → open; "all" → every status; otherwise
// one status. memory narrows to the conflicts one memory is part of.
func (s *Store) Conflicts(ctx context.Context, namespace, status, memory string, limit int) ([]Conflict, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	out := []Conflict{}
	db, err := s.db(ctx)
	if err != nil {
		return out, err
	}
	where, args := []string{}, []any{}
	add := func(cond string, v any) {
		args = append(args, v)
		where = append(where, strings.ReplaceAll(cond, "?", "$"+itoa(len(args))))
	}
	switch status {
	case "all":
	case "":
		add("c.status = ?", ConflictOpen)
	case "resolved":
		where = append(where, "c.status <> 'open'")
	default:
		if !validConflictStatus(status) {
			return out, ErrInvalidInput
		}
		add("c.status = ?", status)
	}
	if namespace != "" {
		add("c.namespace = ?", namespace)
	}
	if memory != "" {
		add("(c.memory_a::text = ? OR c.memory_b::text = ?)", memory)
	}
	q := conflictSelect
	if len(where) > 0 {
		q += " WHERE " + strings.Join(where, " AND ")
	}
	rows, err := db.QueryContext(ctx, q+" ORDER BY (c.status='open') DESC, c.created_at DESC LIMIT "+itoa(limit), args...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		if c, err := scanConflict(rows); err == nil {
			out = append(out, *c)
		}
	}
	return out, rows.Err()
}

func validConflictStatus(s string) bool {
	return s == ConflictOpen || s == ConflictKeepNew || s == ConflictKeepOld || s == ConflictScoped
}

// GetConflict fetches one conflict.
func (s *Store) GetConflict(ctx context.Context, id string) (*Conflict, error) {
	if id == "" {
		return nil, ErrInvalidInput
	}
	db, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	c, err := scanConflict(db.QueryRowContext(ctx, conflictSelect+` WHERE c.id::text = $1`, id))
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return c, err
}

// normResolution maps the accepted spellings onto a status.
func normResolution(r string) string {
	switch strings.ToLower(strings.TrimSpace(r)) {
	case "keep_new", "resolved_keep_new", "new", "b":
		return ConflictKeepNew
	case "keep_old", "resolved_keep_old", "old", "a":
		return ConflictKeepOld
	case "both_valid_scoped", "both_valid", "scoped", "both":
		return ConflictScoped
	case "open", "reopen":
		return ConflictOpen
	}
	return ""
}

// ResolveConflict applies a resolution:
//
//	keep_new → the older memory (a) is invalidated (superseded by b);
//	keep_old → the newer memory (b) is invalidated;
//	both_valid_scoped → both stay valid;
//	open → re-opened (both stay as they are).
//
// The kept side is revived if THIS conflict (or b superseding a) had retired it,
// so an automatic resolution can be overturned. Nothing is hard-deleted.
func (s *Store) ResolveConflict(ctx context.Context, id, resolution, note string) (*Conflict, error) {
	status := normResolution(resolution)
	if status == "" {
		return nil, ErrInvalidInput
	}
	c, err := s.GetConflict(ctx, id)
	if err != nil {
		return nil, err
	}
	db, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	revive := func(keep, other string) {
		_, _ = db.ExecContext(ctx, `
			UPDATE memories SET invalid_at = NULL, superseded_by = NULL,
			       metadata = metadata - 'invalidated_by_conflict'
			 WHERE id = $1 AND invalid_at IS NOT NULL
			   AND (metadata->>'invalidated_by_conflict' = $2 OR superseded_by::text = $3)`, keep, c.ID, other)
	}
	retire := func(lose, by string, supersede bool) {
		var sup any
		if supersede {
			sup = by
		}
		_, _ = db.ExecContext(ctx, `
			UPDATE memories SET invalid_at = now(), superseded_by = COALESCE($3::uuid, superseded_by),
			       metadata = metadata || jsonb_build_object('invalidated_by_conflict', $2::text)
			 WHERE id = $1 AND invalid_at IS NULL`, lose, c.ID, sup)
	}
	pref := c.PreferredID
	switch status {
	case ConflictKeepNew:
		revive(c.B.ID, c.A.ID)
		retire(c.A.ID, c.B.ID, true)
		pref = c.B.ID
	case ConflictKeepOld:
		revive(c.A.ID, c.B.ID)
		retire(c.B.ID, c.A.ID, false)
		pref = c.A.ID
	case ConflictScoped:
		revive(c.A.ID, c.B.ID)
		revive(c.B.ID, c.A.ID)
	}
	// Derived items follow (derivations.go): the retired side's dependents go
	// stale, and a revived side's come back.
	switch status {
	case ConflictKeepNew:
		s.clearStale(ctx, db, []string{c.B.ID})
		s.markDependentsStale(ctx, db, []string{c.A.ID}, "superseded")
	case ConflictKeepOld:
		s.clearStale(ctx, db, []string{c.A.ID})
		s.markDependentsStale(ctx, db, []string{c.B.ID}, "invalidated")
	case ConflictScoped:
		s.clearStale(ctx, db, []string{c.A.ID, c.B.ID})
	}
	var resolvedAt any
	if status != ConflictOpen {
		resolvedAt = time.Now()
	}
	_, err = db.ExecContext(ctx, `
		UPDATE memory_conflicts SET status = $2, resolution_note = NULLIF($3,''), resolved_by = NULLIF($4,''),
		       resolved_at = $5, preferred_id = NULLIF($6,'')::uuid
		 WHERE id = $1`, c.ID, status, note, activityFrom(ctx).Agent, resolvedAt, pref)
	if err != nil {
		return nil, err
	}
	s.bumpEpoch(c.Namespace)
	s.eventMeta(ctx, db, "resolve_conflict", c.Namespace, "", status, nil, 0, map[string]any{
		"conflict": c.ID, "a": c.A.ID, "b": c.B.ID})
	return s.GetConflict(ctx, c.ID)
}

// ConflictCount is the number of open conflicts in a brain ("" → all brains).
func (s *Store) ConflictCount(ctx context.Context, ns string) int {
	db, err := s.db(ctx)
	if err != nil {
		return 0
	}
	var n int
	_ = db.QueryRowContext(ctx, `SELECT count(*) FROM memory_conflicts WHERE status = 'open' AND ($1 = '' OR namespace = $1)`, ns).Scan(&n)
	return n
}
