# Contributing to Zekra

Bug reports, docs and code are all welcome. Open an
[issue](https://github.com/fadymondy/zekra/issues) or a
[discussion](https://github.com/fadymondy/zekra/discussions) first for anything large, then send a
pull request against `main`. Sign off your commits (`git commit -s`, the DCO).

## Develop

- Backend and console: `togo serve` (or `make dev`). Go checks: `go build ./...` and `go test ./...`.
- Web console (`web/`): `npm ci`, then `npm run typecheck`, `npm test` and `npm run build`.
- Language catalogs: `node scripts/i18n/check.mjs` must report 0 problems.

More detail is in [AGENTS.md](AGENTS.md), [docs/quickstart.md](docs/quickstart.md) and
[docs/i18n.md](docs/i18n.md).

## Translate Zekra

Zekra is translated on **Hosted Weblate**: <https://hosted.weblate.org/projects/zekra/>.
Sign in there, pick a component (for example "Web: chat") and a language, and translate in the
browser. No Git knowledge is needed.

- **Don't edit non-English JSON files by hand. Use Weblate.** The catalogs in
  `web/lang/<area>.<locale>.json` (every language except `en`) are owned by Weblate, which
  opens a pull request with your changes. A hand edit to one of them will conflict with
  Weblate's next sync.
- **English is the source.** To change or add copy, edit `web/lang/<area>.en.json` (and the
  Arabic file next to it) in a normal pull request. Weblate picks up the new strings, and the
  other languages show English until they are translated. Keep keys flat and prefixed with the
  area (`brains.title`). Messages are ICU MessageFormat, and placeholders such as `{count}` must
  stay as they are.
- **Glossary.** Weblate has a glossary, and the repo keeps one in
  [lang/glossary.md](lang/glossary.md). Product names (Zekra, MCP, OAuth…) are never translated.
- **Weblate pull requests** are checked like any other: `node scripts/i18n/check.mjs` verifies
  that each language has the same keys and placeholders as English.

### Adding a new language

Weblate can start a translation in any language, but the app only shows a language once it is
wired in. The web console does **not** discover locales on its own: `web/lang/index.ts` imports
each file by hand and lists the non-English languages in `LOADERS`. (Next.js has no
`import.meta.glob`, so there is no automatic discovery.) To add `xx`:

1. Add `xx` to `LOCALES` and `LOCALE_INFO` in `web/lib/intl/locales.ts`, to `LOCALES` in
   `scripts/i18n/catalogs.mjs`, and to both Go `var Locales` tables (`internal/account/i18n.go`
   and `plugins/brain/internal/brain/i18n.go`).
2. In `web/lang/index.ts`, add an `"xx"` entry to `LOADERS` that imports every
   `./<area>.xx.json`, copying an existing entry such as `"es"`.
3. Make sure every `web/lang/<area>.xx.json` exists (Weblate creates them once the language is
   added to each component), then run `node scripts/i18n/check.mjs` and `npm run build`.

The mobile, desktop, extension and store catalogs need their own steps. They are listed in
[docs/i18n.md](docs/i18n.md#adding-a-language).
