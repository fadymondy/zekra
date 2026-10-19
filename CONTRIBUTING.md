# Contributing to Zekra

Thanks for wanting to help. This guide covers how to get a local setup running, the conventions
the codebase follows, and how a change gets merged.

## Ways to contribute

- Report a bug or request a feature through the [issue forms](https://github.com/fadymondy/zekra/issues/new/choose).
- Pick up an issue labelled [`good first issue`](https://github.com/fadymondy/zekra/labels/good%20first%20issue)
  or [`help wanted`](https://github.com/fadymondy/zekra/labels/help%20wanted). Comment on it first so nobody
  duplicates the work.
- Improve the docs. Typos and unclear sentences are worth a PR.

Security problems are **not** issues. Follow [SECURITY.md](SECURITY.md) instead.

## Local setup

Requirements: Go (version in `go.mod`), Node 24, Docker, a Postgres with the VectorChord extensions (`docker/postgres/Dockerfile` builds one), and optionally the [togo CLI](https://to-go.dev).

```bash
cp .env.example .env               # DATABASE_URL, AUTH_SECRET (openssl rand -hex 32), TEI_* URLs
sqlc generate && go run github.com/99designs/gqlgen generate   # or: togo generate
go run ./cmd/zekractl migrate      # account + brain schema + BM25
go run ./cmd/api                   # API on :8080
cd web && npm install && npm run dev   # console on :3020
```

Without an embedding server, retain and recall return `503 no_embedder`; everything else works. See [docs/self-hosting.md](docs/self-hosting.md).

## Before you open a pull request

```bash
go build ./... && go test ./...
for m in plugins/*/; do (cd "$m" && go test ./...); done
cd web && npm run typecheck && npm run build
```

CI runs the same, plus a `docker-compose.selfhost.yml` boot. Schema changes go in `plugins/brain/internal/brain/schema.sql` and must be idempotent (see DEPLOY.md, "schema before binary").

## Conventions

- **Small, focused PRs.** One concern per PR; refactors separate from behaviour changes.
- **Branch names:** `feat/…`, `fix/…`, `docs/…`, `chore/…` off `main`.
- **Commit messages:** [Conventional Commits](https://www.conventionalcommits.org/) style
  (`feat: …`, `fix: …`, `docs: …`), imperative mood, explain *why* in the body.
- **Tests:** a bug fix comes with a test that fails without it; a feature comes with tests for its
  main path and its permission checks.
- **No secrets** in code, tests, fixtures or screenshots. Configuration goes in `.env`
  (documented in `.env.example`).
- **AI-assisted contributions are welcome.** Agents should read [AGENTS.md](AGENTS.md). You are
  responsible for every line you submit: review it, run it, and test it as if you wrote it.

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

## Developer Certificate of Origin (DCO)

Every commit must be signed off, certifying the [Developer Certificate of Origin](https://developercertificate.org/):
you wrote the change, or otherwise have the right to submit it under the project's license.

```bash
git commit -s -m "fix: describe the change"
```

This adds a `Signed-off-by: Your Name <you@example.com>` trailer that matches your Git identity.
Forgot? `git commit --amend -s` for the last commit, or `git rebase --signoff main` for a branch.

## License

Zekra is licensed under the [GNU AGPL-3.0](LICENSE). By contributing you agree your contribution
is licensed under the same terms.

## Community

- **Questions and ideas:** [GitHub Discussions](https://github.com/fadymondy/zekra/discussions)
- **Chat:** [Discord](https://discord.gg/99JBJd6FsR)
- **Bugs and feature requests:** [Issues](https://github.com/fadymondy/zekra/issues/new/choose)

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
