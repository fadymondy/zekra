package brain

/*
Phone camera pairing: scan a QR code on the desktop and the phone opens straight
into the live camera of that brain, with no sign-in on the phone.

  1. The signed-in desktop asks for a pairing (POST /api/brain/media/pair). It gets
     a one-time code that lives a few minutes, shown as a QR code.
  2. The phone opens the link and redeems the code (POST /api/brain/media/cam/redeem).
     The code is spent and the phone gets a camera pass: a bearer token for ONE
     brain, valid for a few hours.
  3. With the pass the phone may only use the camera routes: read live, save a
     frame (an ordinary upload) and poll the media it saved. It never gets a login
     session, so a lost phone or leaked link can do nothing else, and the desktop
     can end the pass at any time.

The pass acts as an OAuth-style Principal for its one brain, so every request is
re-checked against the pairing user's CURRENT access (a user who loses the brain
takes the phone with them). Only hashes of the code and the token are stored.
*/

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

const cameraHeader = "X-Zekra-Camera"

// cameraCodeTTL is how long a QR code may wait to be scanned; cameraPassTTL how
// long the phone may then use the camera (CAMERA_PASS_HOURS, default 4).
const cameraCodeTTL = 5 * time.Minute

func cameraPassTTL() time.Duration {
	if d, err := time.ParseDuration(strings.TrimSpace(os.Getenv("CAMERA_PASS_HOURS")) + "h"); err == nil && d > 0 && d <= 72*time.Hour {
		return d
	}
	return 4 * time.Hour
}

// CameraPairing is what the desktop sees of a pairing.
type CameraPairing struct {
	ID        string     `json:"id"`
	Namespace string     `json:"namespace"`
	Code      string     `json:"code,omitempty"` // only in the create response
	Status    string     `json:"status"`         // waiting | connected | expired | ended
	Device    string     `json:"device,omitempty"`
	ExpiresAt time.Time  `json:"expiresAt"` // the code until connected, then the pass
	Connected *time.Time `json:"connectedAt,omitempty"`
}

type cameraPassKey struct{}

func (s *Service) mountCamera(r chi.Router, sec func(http.HandlerFunc) http.HandlerFunc) {
	// Desktop (signed in).
	r.Post("/api/brain/media/pair", sec(s.CreateCameraPairing))
	r.Get("/api/brain/media/pair/{id}", sec(s.GetCameraPairing))
	r.Delete("/api/brain/media/pair/{id}", sec(s.EndCameraPairing))
	// Phone (camera pass, not the login gate: it authenticates itself).
	r.Post("/api/brain/media/cam/redeem", s.RedeemCameraPairing)
	r.Get("/api/brain/media/cam/session", s.camera(s.CameraSession))
	r.Delete("/api/brain/media/cam/session", s.camera(s.EndCameraSession))
	r.Get("/api/brain/media/cam/live", s.camera(s.LiveMedia))
	r.Post("/api/brain/media/cam/upload", s.camera(s.UploadMedia))
	r.Get("/api/brain/media/cam/media/{id}", s.camera(s.GetMediaH))
}

// CreateCameraPairing — POST /api/brain/media/pair {namespace}: a one-time code
// for the QR. Signed-in users with write access only (not tokens or apps).
func (s *Service) CreateCameraPairing(w http.ResponseWriter, r *http.Request) {
	if !s.noteWriteGuard(w, r) {
		return
	}
	var in struct{ Namespace string }
	if !decodeJSON(w, r, &in) {
		return
	}
	ns := strings.TrimSpace(in.Namespace)
	c := s.identify(r)
	if !c.session || c.userID == "" {
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "sign in to pair a phone"))
		return
	}
	if !s.canWrite(r, ns) {
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "no write access to brain "+ns))
		return
	}
	db, err := s.Store.db(r.Context())
	if err != nil {
		writeErr(w, err)
		return
	}
	code := randomToken(24)
	p := CameraPairing{Namespace: ns, Code: code, Status: "waiting"}
	if err := db.QueryRowContext(r.Context(), `INSERT INTO brain_camera_pass (namespace, user_id, code_hash, code_expires_at)
		VALUES ($1, $2, $3, now() + $4 * interval '1 second') RETURNING id, code_expires_at`,
		ns, c.userID, HashToken(code), int(cameraCodeTTL.Seconds())).Scan(&p.ID, &p.ExpiresAt); err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

// pairingFor loads a pairing the signed-in caller created.
func (s *Service) pairingFor(w http.ResponseWriter, r *http.Request) (*CameraPairing, bool) {
	c := s.identify(r)
	db, err := s.Store.db(r.Context())
	if err != nil {
		writeErr(w, err)
		return nil, false
	}
	var p CameraPairing
	var redeemed, revoked sql.NullTime
	var codeExp time.Time
	var passExp sql.NullTime
	err = db.QueryRowContext(r.Context(), `SELECT id, namespace, coalesce(device,''), code_expires_at, expires_at, redeemed_at, revoked_at
		FROM brain_camera_pass WHERE id::text=$1 AND user_id=$2`, chi.URLParam(r, "id"), c.userID).
		Scan(&p.ID, &p.Namespace, &p.Device, &codeExp, &passExp, &redeemed, &revoked)
	if err != nil || c.userID == "" {
		writeJSON(w, http.StatusNotFound, apiErr("not_found", "brain: not found"))
		return nil, false
	}
	now := time.Now()
	switch {
	case revoked.Valid:
		p.Status, p.ExpiresAt = "ended", codeExp
	case redeemed.Valid:
		p.Status, p.ExpiresAt, p.Connected = "connected", passExp.Time, &redeemed.Time
		if now.After(passExp.Time) {
			p.Status = "expired"
		}
	default:
		p.Status, p.ExpiresAt = "waiting", codeExp
		if now.After(codeExp) {
			p.Status = "expired"
		}
	}
	return &p, true
}

// GetCameraPairing — GET /api/brain/media/pair/{id}: has the phone connected yet?
func (s *Service) GetCameraPairing(w http.ResponseWriter, r *http.Request) {
	if p, ok := s.pairingFor(w, r); ok {
		writeJSON(w, http.StatusOK, p)
	}
}

// EndCameraPairing — DELETE /api/brain/media/pair/{id}: cancel the code or end
// the phone's pass now.
func (s *Service) EndCameraPairing(w http.ResponseWriter, r *http.Request) {
	p, ok := s.pairingFor(w, r)
	if !ok {
		return
	}
	db, err := s.Store.db(r.Context())
	if err != nil {
		writeErr(w, err)
		return
	}
	if _, err := db.ExecContext(r.Context(), `UPDATE brain_camera_pass SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL`, p.ID); err != nil {
		writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// RedeemCameraPairing — POST /api/brain/media/cam/redeem {code}: spends the code
// (once) and returns the phone's camera pass.
func (s *Service) RedeemCameraPairing(w http.ResponseWriter, r *http.Request) {
	var in struct{ Code string }
	if !decodeJSON(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.Code) == "" {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "code is required"))
		return
	}
	db, err := s.Store.db(r.Context())
	if err != nil {
		writeErr(w, err)
		return
	}
	token := randomToken(32)
	device := oauthClip(r.UserAgent(), 200)
	var ns string
	var exp time.Time
	err = db.QueryRowContext(r.Context(), `UPDATE brain_camera_pass
		SET token_hash=$2, redeemed_at=now(), expires_at=now() + $3 * interval '1 second', device=$4
		WHERE code_hash=$1 AND redeemed_at IS NULL AND revoked_at IS NULL AND code_expires_at > now()
		RETURNING namespace, expires_at`, HashToken(strings.TrimSpace(in.Code)), HashToken(token), int(cameraPassTTL().Seconds()), device).Scan(&ns, &exp)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusGone, apiErr("expired", "this QR code was already used or has expired; show a new one"))
		return
	}
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSONNoStore(w, http.StatusOK, map[string]any{"token": token, "namespace": ns, "expiresAt": exp})
}

// CameraSession — GET /api/brain/media/cam/session: the pass's brain and expiry.
func (s *Service) CameraSession(w http.ResponseWriter, r *http.Request) {
	p, _ := r.Context().Value(cameraPassKey{}).(*cameraPass)
	writeJSON(w, http.StatusOK, map[string]any{"namespace": p.namespace, "expiresAt": p.expires, "reader": s.Store.mediaReader() != nil})
}

// EndCameraSession — DELETE /api/brain/media/cam/session: the phone leaves; the pass ends.
func (s *Service) EndCameraSession(w http.ResponseWriter, r *http.Request) {
	p, _ := r.Context().Value(cameraPassKey{}).(*cameraPass)
	db, err := s.Store.db(r.Context())
	if err != nil {
		writeErr(w, err)
		return
	}
	if _, err := db.ExecContext(r.Context(), `UPDATE brain_camera_pass SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL`, p.id); err != nil {
		writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type cameraPass struct {
	id, namespace, userID string
	expires               time.Time
}

// camera authenticates a phone by its camera pass (header, or ?cam= for the
// websocket, which cannot send headers) and runs h as a Principal limited to
// that one brain.
func (s *Service) camera(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tok := strings.TrimSpace(r.Header.Get(cameraHeader))
		if tok == "" {
			tok = r.URL.Query().Get("cam")
		}
		p, err := s.lookupCameraPass(r.Context(), tok)
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, apiErr("unauthenticated", "the camera link has ended; scan a new QR code"))
			return
		}
		pr := &Principal{UserID: p.userID, GrantID: "camera:" + p.id, ClientName: "Phone camera",
			Scopes: []string{ScopeRead, ScopeWrite}, Namespaces: map[string]bool{p.namespace: true}}
		c := caller{agent: "camera:" + p.userID, valid: true, principal: pr, userID: p.userID}
		if !s.oauthCan(r.Context(), pr, p.namespace, true) {
			writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "no write access to brain "+p.namespace))
			return
		}
		// Every camera route is about the pass's own brain.
		if ns := r.URL.Query().Get("namespace"); ns != "" && ns != p.namespace {
			writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "this camera link is for brain "+p.namespace))
			return
		}
		ctx := context.WithValue(r.Context(), callerKey{}, &c)
		ctx = context.WithValue(ctx, cameraPassKey{}, p)
		ctx = WithActivity(ctx, Activity{Agent: c.agent, Client: "camera"})
		h(w, r.WithContext(ctx))
	}
}

func (s *Service) lookupCameraPass(ctx context.Context, tok string) (*cameraPass, error) {
	if tok == "" {
		return nil, errors.New("no pass")
	}
	db, err := s.Store.db(ctx)
	if err != nil {
		return nil, err
	}
	var p cameraPass
	err = db.QueryRowContext(ctx, `SELECT id, namespace, user_id, expires_at FROM brain_camera_pass
		WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at > now()`, HashToken(tok)).
		Scan(&p.id, &p.namespace, &p.userID, &p.expires)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// isCamera reports whether the request came through a camera pass.
func isCamera(r *http.Request) bool {
	_, ok := r.Context().Value(cameraPassKey{}).(*cameraPass)
	return ok
}
