package account

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/togo-framework/mail"
	"github.com/togo-framework/togo"
)

/*
Sending mail.

fadymondy sends through its own SMTP mailer (internal/mail). Zekra sends through
Resend, reusing the togo stack:

 1. The togo `mail` plugin, when its driver is a real one (MAIL_DRIVER=resend
    with the mail-resend plugin, or smtp): the configured service sends.
 2. Otherwise RESEND_API_KEY alone is enough: the message goes to Resend's
    HTTP API directly (the same request mail-resend makes), so setting the key
    does not also require MAIL_DRIVER.
 3. Otherwise nothing can send: outside production the message — code included
    — is written to the log so the flows can be walked without an inbox. In
    production only a warning is logged, never the body (it carries codes).

MAIL_FROM is the sender ("Zekra <no-reply@zekra.dev>").
*/

// Message is one email.
type Message struct {
	To      string
	Subject string
	Text    string
	HTML    string
}

const resendEndpoint = "https://api.resend.com/emails"

func mailFrom() string {
	if f := strings.TrimSpace(os.Getenv("MAIL_FROM")); f != "" {
		return f
	}
	return "Zekra <no-reply@zekra.dev>"
}

// NewSender picks the sender for this process (see the package comment above).
func NewSender(k *togo.Kernel, log *slog.Logger) func(ctx context.Context, msg Message) error {
	if log == nil {
		log = slog.Default()
	}
	if k != nil {
		if svc, ok := mail.FromKernel(k); ok && svc != nil && svc.Driver() != "log" {
			log.Info("account mail: sending via togo mail", "driver", svc.Driver())
			return func(ctx context.Context, msg Message) error {
				return svc.Send(ctx, mail.Message{From: mailFrom(), To: []string{msg.To}, Subject: msg.Subject, Text: msg.Text, HTML: msg.HTML})
			}
		}
	}
	if key := strings.TrimSpace(os.Getenv("RESEND_API_KEY")); key != "" {
		log.Info("account mail: sending via Resend")
		client := &http.Client{Timeout: 15 * time.Second}
		return func(ctx context.Context, msg Message) error { return sendResend(ctx, client, key, msg) }
	}
	if isProductionEnv() {
		log.Warn("account mail: no RESEND_API_KEY / mail driver configured — verification, reset and sign-in codes cannot be delivered")
		return func(_ context.Context, msg Message) error {
			log.Warn("account mail not sent: no mail service configured", "subject", msg.Subject)
			return errors.New("no mail service configured")
		}
	}
	log.Warn("account mail: no RESEND_API_KEY — dev fallback writes emails (and their codes) to the log")
	return func(_ context.Context, msg Message) error {
		log.Warn("DEV MAIL (not sent)", "to", msg.To, "subject", msg.Subject, "text", msg.Text)
		return nil
	}
}

func sendResend(ctx context.Context, client *http.Client, key string, msg Message) error {
	body := map[string]any{"from": mailFrom(), "to": []string{msg.To}, "subject": msg.Subject}
	if msg.HTML != "" {
		body["html"] = msg.HTML
	}
	if msg.Text != "" {
		body["text"] = msg.Text
	}
	buf, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, resendEndpoint, bytes.NewReader(buf))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("resend: status %d: %s", resp.StatusCode, string(b))
	}
	return nil
}

// ---- templates ------------------------------------------------------------------

const brand = "Zekra"

func brandHost() string {
	if u := publicURL(); u != "" {
		u = strings.TrimPrefix(strings.TrimPrefix(u, "https://"), "http://")
		return u
	}
	return "zekra.dev"
}

// CodeEmail is the 6-digit code for verifying an address, resetting a password
// or signing in without one. Same copy structure as fadymondy's, Zekra-branded.
func CodeEmail(locale, purpose, code string) (subject, text, htmlBody string) {
	spaced := strings.Join(strings.Split(code, ""), " ")
	box := fmt.Sprintf(`<p style="margin:16px 0;font-size:28px;letter-spacing:6px;font-weight:600;font-family:ui-monospace,Menlo,monospace;" dir="ltr">%s</p>`, html.EscapeString(code))

	type copyText struct{ subject, lead, heading, intro, foot string }
	var c copyText
	switch {
	case locale == "ar" && purpose == purposeLogin:
		c = copyText{"رمز تسجيل الدخول", "رمز تسجيل الدخول إلى حسابك على " + brand + ":", "تسجيل الدخول",
			"أدخل هذا الرمز لتسجيل الدخول:",
			"الرمز صالح لمدة 15 دقيقة. إذا لم تطلب ذلك، تجاهل الرسالة — لا يمكن لأحد الدخول بدون هذا الرمز."}
	case locale == "ar" && purpose == purposeReset:
		c = copyText{"رمز إعادة تعيين كلمة المرور", "رمز إعادة تعيين كلمة المرور لحسابك على " + brand + ":", "إعادة تعيين كلمة المرور",
			"أدخل هذا الرمز لاختيار كلمة مرور جديدة:",
			"الرمز صالح لمدة 15 دقيقة. إذا لم تطلب ذلك، تجاهل الرسالة — كلمة مرورك لم تتغير."}
	case locale == "ar":
		c = copyText{"رمز تأكيد بريدك الإلكتروني", "رمز تأكيد بريدك الإلكتروني لحسابك الجديد على " + brand + ":", "أكّد بريدك الإلكتروني",
			"أدخل هذا الرمز لتفعيل حسابك:",
			"الرمز صالح لمدة 15 دقيقة. إذا لم تنشئ حسابًا، تجاهل الرسالة."}
	case purpose == purposeLogin:
		c = copyText{"Your " + brand + " sign-in code", "Your code to sign in to " + brand + ":", "Sign in",
			"Enter this code to sign in:",
			"It works for 15 minutes. If you did not ask for this, ignore this email — nobody can sign in without the code."}
	case purpose == purposeReset:
		c = copyText{"Your " + brand + " password reset code", "Your code to reset your " + brand + " password:", "Reset your password",
			"Enter this code to choose a new password:",
			"It works for 15 minutes. If you did not ask for this, ignore this email — your password has not changed."}
	default:
		c = copyText{"Your " + brand + " verification code", "Your code to verify the email for your new " + brand + " account:", "Verify your email",
			"Enter this code to activate your account:",
			"It works for 15 minutes. If you did not create an account, ignore this email."}
	}
	subject = c.subject
	text = c.lead + "\n\n" + spaced + "\n\n" + c.foot
	htmlBody = shell(locale, c.heading,
		`<p style="margin:0;">`+html.EscapeString(c.intro)+`</p>`+box+`<p style="margin:0;">`+html.EscapeString(c.foot)+`</p>`)
	return subject, text, htmlBody
}

// ExportEmail carries the one-time download link of a data export.
func ExportEmail(locale, link string, hours int) (subject, text, htmlBody string) {
	type copyText struct{ subject, heading, intro, button, foot string }
	c := copyText{
		"Your " + brand + " data is ready",
		"Your data export",
		"The copy of your data you asked for is ready: a zip with a readable page and a JSON file.",
		"Download your data",
		fmt.Sprintf("The link works once, for %d hours. If you did not ask for this, change your password — someone signed in to your account.", hours),
	}
	if locale == "ar" {
		c = copyText{
			"بياناتك على " + brand + " جاهزة",
			"تصدير بياناتك",
			"نسخة بياناتك التي طلبتها جاهزة: ملف مضغوط فيه صفحة مقروءة وملف JSON.",
			"تنزيل بياناتك",
			fmt.Sprintf("الرابط يعمل مرة واحدة فقط خلال %d ساعة. إذا لم تطلب ذلك، غيّر كلمة المرور — فقد دخل أحد إلى حسابك.", hours),
		}
	}
	subject = c.subject
	text = c.intro + "\n\n" + link + "\n\n" + c.foot
	button := fmt.Sprintf(`<p style="margin:20px 0;"><a href="%s" style="display:inline-block;padding:10px 18px;background:#111827;color:#fff;text-decoration:none;font-weight:600;border-radius:6px;">%s</a></p>`,
		html.EscapeString(link), html.EscapeString(c.button))
	htmlBody = shell(locale, c.heading,
		`<p style="margin:0;">`+html.EscapeString(c.intro)+`</p>`+button+`<p style="margin:0;">`+html.EscapeString(c.foot)+`</p>`)
	return subject, text, htmlBody
}

// shell wraps body content in a simple table-based frame (inline styles only:
// mail clients drop stylesheets). Arabic renders RTL.
func shell(locale, heading, bodyHTML string) string {
	dir, align := "ltr", "left"
	font := "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
	if locale == "ar" {
		dir, align = "rtl", "right"
		font = "Lusail, 'IBM Plex Sans Arabic', 'Segoe UI', Tahoma, sans-serif"
	}
	return fmt.Sprintf(`<!doctype html>
<html dir="%s" lang="%s">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f5f5f4;">
  <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" dir="%s" style="background:#f5f5f4;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #e7e5e4;border-radius:8px;">
        <tr><td style="padding:28px 28px 8px 28px;text-align:%s;">
          <h1 style="margin:0;font-family:%s;font-size:20px;font-weight:600;color:#111827;">%s</h1>
        </td></tr>
        <tr><td style="padding:8px 28px 24px 28px;text-align:%s;font-family:%s;font-size:15px;line-height:1.6;color:#374151;">%s</td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #e7e5e4;text-align:%s;font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#6b7280;">%s</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`,
		dir, html.EscapeString(locale), dir,
		align, font, html.EscapeString(heading),
		align, font, bodyHTML,
		align, html.EscapeString(brandHost()))
}
