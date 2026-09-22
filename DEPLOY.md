# Deploying Zekra

Production is **app.zekra.dev**, served from one LXC container on the Proxmox host
`pve-3x1`. This document describes that setup as it actually runs; it was rewritten
on 2026-09-23 after an earlier version turned out to describe a Docker deployment
that production does not use.

## Topology

```
Cloudflare ─► Nginx Proxy Manager (LXC 100, npm.3x1.io)
                 ├─ app.zekra.dev   ─► 10.10.10.109:3020  (console)  + /api,/events,/graphql ─► :8080
                 ├─ mcp.zekra.dev   ─► 10.10.10.109:8080/api/mcp
                 └─ zekra.dev       ─► public site (fadymondy.com-v2, 10.10.10.101:8083)
                                       + /api,/events,/graphql,/install.sh,/upgrade.sh,/.well-known ─► 10.10.10.109:8080
                                       (the same API as app.zekra.dev, so the short `zekra.dev/install.sh`
                                       keeps working for the CLI — do not remove these routes)
LXC 109 "zekra" (10.10.10.109)
  zekra.service      Go API          /opt/zekra/zekra-api        env /etc/zekra/zekra.env   :8080
  zekra-web.service  Next console    /opt/zekra-web (standalone)  docker node:24-bookworm-slim :3020
  docker zekra-pg    Postgres 17 + vchord / vchord_bm25 / pg_tokenizer / pg_partman
                     127.0.0.1:5432, network `zekra`, volume `zekra-pgdata`
  docker tei-embed   BAAI/bge-m3 (1024-d)              127.0.0.1:18081
  docker tei-rerank  BAAI/bge-reranker-v2-m3 (CPU)     127.0.0.1:18082
```

NPM routes by IP, so container renames inside LXC 109 never need an NPM change.
The former domains `cabrain-app.fadymondy.com` (308 → app.zekra.dev, method and body
preserved for old API clients) and `cabrain.fadymondy.com` (301 → zekra.dev) are
redirect-only.

Access: `ssh pve-3x1`, then `pct exec 109 -- …` / `pct push 109 <src> <dst>`.
Scripts are easier to push and run than to quote through ssh + pct.

## The rule that matters: schema before binary

**The API does not migrate its database at boot.** A binary that reads a new column
will fail every query that touches it until the schema exists. So every deploy is:

1. Diff `plugins/brain/internal/brain/schema.sql` against the last deployed commit.
2. Apply that delta as the `zekra` role (`docker exec -i zekra-pg psql -U zekra -d zekra`).
3. Only then swap the binary.

Do not simply re-run the whole `schema.sql` as `zekra`: that role owns `notes` and
`brain_profiles` but not `memories`, `entities` or `secrets` (owned by `postgres`),
so it stops at the first `ALTER` on those. Changes to postgres-owned tables need
`-U postgres`.

## Building

```bash
# API — static linux binary
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o zekra-api ./cmd/api

# Console — build INSIDE the runtime image so native modules (sharp) are linux.
# Needs the repo's docs/ beside web/ (next.config.mjs bundles them).
docker run --rm -v "$PWD:/src:ro" -v "$OUT:/out" node:24-bookworm-slim bash -c '
  mkdir /build && cd /src && tar --exclude=web/node_modules --exclude=web/.next -cf - web docs | tar -C /build -xf -
  cd /build/web && npm ci && npm run build
  mkdir -p /out/zekra-web/.next && cp -a .next/standalone/. /out/zekra-web/
  cp -a .next/static /out/zekra-web/.next/static && cp -a public assets content /out/zekra-web/'
```

The console build bakes `NEXT_PUBLIC_*` from `web/.env.production`; the server keeps
its own copy of that file, which must be carried across on deploy.

## Deploying

```bash
# API
cp -a /opt/zekra/zekra-api /opt/zekra/zekra-api.bak-$(date +%Y%m%d-%H%M%S)
install -o zekra -g zekra -m 755 zekra-api /opt/zekra/zekra-api
systemctl restart zekra          # healthy in ~2s: curl :8080/api/brain/mine -> 401

# Console
tar --no-same-owner -xzf zekra-web.tgz -C /opt/zekra-web.new
cp -a /opt/zekra-web/.env.production /opt/zekra-web.new/
rm -rf /opt/zekra-web.prev && mv /opt/zekra-web /opt/zekra-web.prev && mv /opt/zekra-web.new /opt/zekra-web
systemctl restart zekra-web      # curl :3020/en/login -> 200
```

Rollback: reinstall the newest `zekra-api.bak-*`, or swap `/opt/zekra-web.prev` back.
Take a `pg_dump -Fc` into `/root/backups/` before any schema change.

## Configuration

`/etc/zekra/zekra.env` (mode 600) holds `DATABASE_URL`, `AUTH_SECRET`,
`ZEKRA_SECRETS_KEY`, the TEI URLs, the OAuth client ids/secrets
(`GOOGLE_*`, `GITHUB_*`; callbacks under `https://app.zekra.dev/api/auth/*/callback`),
mail, and the LLM endpoints. Never commit it.

Tunables worth knowing:

| Var | Default | Why |
|---|---|---|
| `BRAIN_BM25_TOKENIZER` | `zekra_ml` | llmlingua2 multilingual tokenizer in `tokenizer_catalog`. |
| `BRAIN_RERANK_TIMEOUT` | `4s` | The CPU reranker costs ~2.2s per document; past this budget recall keeps the hybrid (RRF) order instead of timing out. `0` disables reranking. |
| `BRAIN_HNSW_EF_SEARCH` | `200` | Candidate list for the vector index; lower values drop results because most rows are superseded. |

## Known issues

- Every restart of a build whose DSN points at the Docker-network host `pg` spends
  90s in `waitForDatabase` before serving (MH-325). Production (DSN on `127.0.0.1`)
  starts in ~2s.
- The reranker is the recall bottleneck on this hardware; a smaller multilingual
  cross-encoder or a GPU would let it run within budget.
