package brain

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// Realtime SSE fan-out — a tiny in-process hub so the dashboard (and any client)
// gets live updates when brain actions happen over MCP or from other users. No
// external realtime provider needed. Endpoint: GET /api/brain/events.
//
// Scoped per caller: every event carries the brain it is about, and a
// subscriber only receives events for brains it can read. Admins get everything;
// events that name no brain go to admins only.

type subscriber struct {
	ch    chan string
	allow func(ns string) bool // nil = everything (admin)
}

type hub struct {
	mu   sync.Mutex
	subs map[*subscriber]struct{}
}

func newHub() *hub { return &hub{subs: map[*subscriber]struct{}{}} }

// publish fans an event out to the subscribers allowed to see it (non-blocking;
// drops on a full subscriber).
func (h *hub) publish(event string, payload map[string]any) {
	if h == nil {
		return
	}
	if payload == nil {
		payload = map[string]any{}
	}
	payload["ts"] = time.Now().UTC().Format(time.RFC3339)
	ns, _ := payload["namespace"].(string)
	b, _ := json.Marshal(payload)
	msg := "event: " + event + "\ndata: " + string(b) + "\n\n"
	h.mu.Lock()
	subs := make([]*subscriber, 0, len(h.subs))
	for sub := range h.subs {
		subs = append(subs, sub)
	}
	h.mu.Unlock()
	// Filters may hit the database, so they run outside the lock.
	for _, sub := range subs {
		if sub.allow != nil && (ns == "" || !sub.allow(ns)) {
			continue
		}
		select {
		case sub.ch <- msg:
		default:
		}
	}
}

func (h *hub) subscribe(allow func(string) bool) *subscriber {
	sub := &subscriber{ch: make(chan string, 32), allow: allow}
	h.mu.Lock()
	h.subs[sub] = struct{}{}
	h.mu.Unlock()
	return sub
}

func (h *hub) unsubscribe(sub *subscriber) {
	h.mu.Lock()
	delete(h.subs, sub)
	h.mu.Unlock()
}

// readFilter answers "may this caller read ns?" with a short per-brain cache,
// so a membership change reaches an open stream within a minute.
func (s *Service) readFilter(r *http.Request) func(string) bool {
	type entry struct {
		ok bool
		at time.Time
	}
	var mu sync.Mutex
	cache := map[string]entry{}
	return func(ns string) bool {
		mu.Lock()
		e, hit := cache[ns]
		mu.Unlock()
		if hit && time.Since(e.at) < time.Minute {
			return e.ok
		}
		ok := s.canRead(r, ns)
		mu.Lock()
		cache[ns] = entry{ok: ok, at: time.Now()}
		mu.Unlock()
		return ok
	}
}

// Events is the SSE stream endpoint. Clients: new EventSource('/api/brain/events').
func (s *Service) Events(w http.ResponseWriter, r *http.Request) {
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	c := s.identify(r)
	if !c.valid {
		writeJSON(w, http.StatusUnauthorized, apiErr("unauthenticated", "sign in or present a token"))
		return
	}
	var allow func(string) bool
	if !c.admin {
		allow = s.readFilter(r)
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	sub := s.hub.subscribe(allow)
	defer s.hub.unsubscribe(sub)

	fmt.Fprint(w, ": connected\n\n")
	fl.Flush()
	ping := time.NewTicker(25 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case msg := <-sub.ch:
			fmt.Fprint(w, msg)
			fl.Flush()
		case <-ping.C:
			fmt.Fprint(w, ": ping\n\n")
			fl.Flush()
		}
	}
}
