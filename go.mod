module github.com/fadymondy/zekra

go 1.26.4

require (
	github.com/99designs/gqlgen v0.17.66
	github.com/danielgtaylor/huma/v2 v2.27.0
	github.com/go-chi/chi/v5 v5.3.0
	github.com/togo-framework/brain v0.0.0
	github.com/togo-framework/brain-cognee v0.0.0
	github.com/togo-framework/brain-tei v0.0.0
	github.com/togo-framework/cache v0.3.0
	github.com/togo-framework/cache-redis v0.0.0
	github.com/togo-framework/db-postgres v0.1.0
	github.com/togo-framework/queue v0.3.0
	github.com/togo-framework/storage v0.2.0
	github.com/togo-framework/togo v0.21.0
	github.com/vektah/gqlparser/v2 v2.5.22
	// SQLite is the built-in default driver. Postgres/MySQL/Mongo drivers come from
	// their db-* PLUGIN (added to internal/plugins by `togo new --db`), which pulls
	// the raw driver transitively — so it isn't a direct dependency of this app.
	modernc.org/sqlite v1.53.0
)

// The brain plugin is developed in-repo (monorepo dev harness). Resolve it
// locally so all go tooling (build, `go mod tidy`, `togo generate`) works
// without the published github.com/togo-framework/brain repo. Removed when the
// harness consumes the published plugin.
replace github.com/togo-framework/brain => ./plugins/brain

replace github.com/togo-framework/brain-tei => ./plugins/brain-tei

replace github.com/togo-framework/brain-cognee => ./plugins/brain-cognee

replace github.com/togo-framework/cache-redis => ./plugins/cache-redis

require (
	github.com/jackc/pgx/v5 v5.10.0
	github.com/togo-framework/aeo v0.1.0
	github.com/togo-framework/ai v0.1.0
	github.com/togo-framework/ai-adk v0.1.0
	github.com/togo-framework/ai-agentops v0.1.0
	github.com/togo-framework/ai-agno v0.1.0
	github.com/togo-framework/ai-anthropic v0.1.0
	github.com/togo-framework/ai-crawlee v0.1.0
	github.com/togo-framework/ai-deepseek v0.1.0
	github.com/togo-framework/ai-firecrawl v0.1.0
	github.com/togo-framework/ai-gateway v0.1.1
	github.com/togo-framework/ai-gemini v0.1.0
	github.com/togo-framework/ai-grok v0.1.0
	github.com/togo-framework/ai-ollama v0.1.0
	github.com/togo-framework/ai-openai v0.1.0
	github.com/togo-framework/ai-playwright v0.1.0
	github.com/togo-framework/ai-qwen v0.1.0
	github.com/togo-framework/ai-rag v0.1.0
	github.com/togo-framework/ai-rss v0.1.0
	github.com/togo-framework/ai-searxng v0.1.0
	github.com/togo-framework/ai-stt v0.1.0
	github.com/togo-framework/ai-tts v0.1.0
	github.com/togo-framework/analytics v0.1.1
	github.com/togo-framework/audit v0.1.1
	github.com/togo-framework/auth v0.8.1
	github.com/togo-framework/auth-firebase v0.1.0
	github.com/togo-framework/auth-mfa v0.1.0
	github.com/togo-framework/auth-oauth v0.2.0
	github.com/togo-framework/auth-passkeys v0.1.0
	github.com/togo-framework/auth-platform v0.1.2
	github.com/togo-framework/auth-saml v0.1.0
	github.com/togo-framework/auth-session-redis v0.1.0
	github.com/togo-framework/auth-workos v0.1.0
	github.com/togo-framework/authz v0.1.1
	github.com/togo-framework/autopilot v0.10.0
	github.com/togo-framework/backup v0.1.1
	github.com/togo-framework/billing v0.1.0
	github.com/togo-framework/board v0.1.0
	github.com/togo-framework/bot v0.1.0
	github.com/togo-framework/bot-discord v0.1.0
	github.com/togo-framework/bot-slack v0.1.0
	github.com/togo-framework/bot-telegram v0.1.0
	github.com/togo-framework/catalog v0.1.0
	github.com/togo-framework/chat v0.1.0
	github.com/togo-framework/chat-ai v0.1.0
	github.com/togo-framework/cms v0.1.1
	github.com/togo-framework/cms-blog v0.1.0
	github.com/togo-framework/cms-notes v0.1.0
	github.com/togo-framework/coder v0.1.0
	github.com/togo-framework/command-palette v0.1.0
	github.com/togo-framework/compose v0.1.0
	github.com/togo-framework/compute v0.1.0
	github.com/togo-framework/compute-beam v0.1.0
	github.com/togo-framework/compute-databricks v0.1.0
	github.com/togo-framework/compute-flink v0.1.0
	github.com/togo-framework/compute-spark v0.1.0
	github.com/togo-framework/contact v0.1.0
	github.com/togo-framework/contacts v0.1.0
	github.com/togo-framework/contacts-google v0.1.0
	github.com/togo-framework/content-mcp v0.1.0
	github.com/togo-framework/content-registry v0.1.0
	github.com/togo-framework/dashboard v0.8.0
	github.com/togo-framework/data v0.1.0
	github.com/togo-framework/data-bigquery v0.1.0
	github.com/togo-framework/data-databricks v0.1.0
	github.com/togo-framework/data-iceberg v0.1.0
	github.com/togo-framework/db-mongodb v0.1.0
	github.com/togo-framework/db-mysql v0.1.0
	github.com/togo-framework/db-supabase v0.1.0
	github.com/togo-framework/deploy v0.1.0
	github.com/togo-framework/deploy-aws v0.1.0
	github.com/togo-framework/deploy-azure v0.1.0
	github.com/togo-framework/deploy-centos v0.1.0
	github.com/togo-framework/deploy-debian v0.1.0
	github.com/togo-framework/deploy-digitalocean v0.1.0
	github.com/togo-framework/deploy-docker v0.1.0
	github.com/togo-framework/deploy-gcp v0.1.0
	github.com/togo-framework/deploy-hetzner v0.1.0
	github.com/togo-framework/deploy-kubernetes v0.1.0
	github.com/togo-framework/deploy-ovh v0.1.0
	github.com/togo-framework/deploy-terraform v0.1.0
	github.com/togo-framework/deploy-ubuntu v0.1.0
	github.com/togo-framework/deploy-vultr v0.1.0
	github.com/togo-framework/dns v0.1.0
	github.com/togo-framework/dns-caddy v0.1.0
	github.com/togo-framework/dns-cloudflare v0.1.0
	github.com/togo-framework/dns-kong v0.1.0
	github.com/togo-framework/dns-npm v0.1.0
	github.com/togo-framework/experience v0.1.0
	github.com/togo-framework/faker v0.1.0
	github.com/togo-framework/feed v0.1.0
	github.com/togo-framework/flags v0.1.2
	github.com/togo-framework/gaming v0.1.0
	github.com/togo-framework/geo v0.1.0
	github.com/togo-framework/github-cards v0.1.0
	github.com/togo-framework/i18n v0.2.0
	github.com/togo-framework/import-export v0.1.1
	github.com/togo-framework/inline-cms v0.1.0
	github.com/togo-framework/knowledge-base v0.1.1
	github.com/togo-framework/live v0.1.0
	github.com/togo-framework/live-notify v0.1.0
	github.com/togo-framework/live-whatsapp v0.1.0
	github.com/togo-framework/location v0.1.0
	github.com/togo-framework/log v0.1.0
	github.com/togo-framework/log-datadog v0.1.0
	github.com/togo-framework/log-logstash v0.1.0
	github.com/togo-framework/log-sentry v0.1.0
	github.com/togo-framework/mail v0.1.0
	github.com/togo-framework/mail-inbound v0.1.1
	github.com/togo-framework/mail-resend v0.1.0
	github.com/togo-framework/mail-sendgrid v0.1.0
	github.com/togo-framework/media v0.1.0
	github.com/togo-framework/model-behaviors v0.1.0
	github.com/togo-framework/money v0.1.0
	github.com/togo-framework/notification-center v0.1.1
	github.com/togo-framework/notifications v0.1.0
	github.com/togo-framework/notifications-discord v0.1.0
	github.com/togo-framework/notifications-fcm v0.1.0
	github.com/togo-framework/notifications-onesignal v0.1.0
	github.com/togo-framework/notifications-pusher v0.1.0
	github.com/togo-framework/notifications-slack v0.1.0
	github.com/togo-framework/notifications-webpush v0.1.0
	github.com/togo-framework/oauth-server v0.1.1
	github.com/togo-framework/observability v0.1.1
	github.com/togo-framework/ocr v0.1.0
	github.com/togo-framework/omnigent v0.1.0
	github.com/togo-framework/ontology v0.1.0
	github.com/togo-framework/orm v0.1.0
	github.com/togo-framework/os v0.1.0
	github.com/togo-framework/page-sections v0.1.0
	github.com/togo-framework/payment v0.1.0
	github.com/togo-framework/payment-fawry v0.1.0
	github.com/togo-framework/payment-lemonsqueezy v0.1.0
	github.com/togo-framework/payment-moyasar v0.1.0
	github.com/togo-framework/payment-payfort v0.1.0
	github.com/togo-framework/payment-paymob v0.1.0
	github.com/togo-framework/payment-paytabs v0.1.0
	github.com/togo-framework/payment-stripe v0.1.0
	github.com/togo-framework/payment-tap v0.1.0
	github.com/togo-framework/pdf v0.1.0
	github.com/togo-framework/plugin-auth-supabase v0.2.1
	github.com/togo-framework/plugin-host v0.1.1
	github.com/togo-framework/portfolio v0.1.0
	github.com/togo-framework/providers v0.1.0
	github.com/togo-framework/queue-dashboard v0.1.1
	github.com/togo-framework/queue-kafka v0.1.0
	github.com/togo-framework/queue-nats v0.1.0
	github.com/togo-framework/queue-rabbitmq v0.1.0
	github.com/togo-framework/rag-postgres v0.1.0
	github.com/togo-framework/ratelimit v0.1.0
	github.com/togo-framework/realtime v0.2.0
	github.com/togo-framework/realtime-grpc v0.1.0
	github.com/togo-framework/realtime-nats v0.1.0
	github.com/togo-framework/realtime-ws v0.2.0
	github.com/togo-framework/richtext v0.1.0
	github.com/togo-framework/saas v0.1.0
	github.com/togo-framework/scheduler v0.1.0
	github.com/togo-framework/search v0.1.0
	github.com/togo-framework/search-algolia v0.1.0
	github.com/togo-framework/search-elasticsearch v0.1.0
	github.com/togo-framework/search-meilisearch v0.1.0
	github.com/togo-framework/search-typesense v0.1.0
	github.com/togo-framework/seo v0.1.0
	github.com/togo-framework/seo-head v0.1.0
	github.com/togo-framework/services v0.1.0
	github.com/togo-framework/settings v0.1.1
	github.com/togo-framework/sharing v0.1.0
	github.com/togo-framework/site-search v0.1.0
	github.com/togo-framework/skills v0.1.0
	github.com/togo-framework/social v0.1.0
	github.com/togo-framework/storage-gdrive v0.1.0
	github.com/togo-framework/storage-r2 v0.1.0
	github.com/togo-framework/storage-s3 v0.1.0
	github.com/togo-framework/storage-supabase v0.1.0
	github.com/togo-framework/subscriptions v0.1.0
	github.com/togo-framework/testimonials v0.1.0
	github.com/togo-framework/testing v0.1.0
	github.com/togo-framework/tools v0.1.0
	github.com/togo-framework/translation v0.1.0
	github.com/togo-framework/tunnel v0.1.0
	github.com/togo-framework/tunnel-cloudflare v0.1.0
	github.com/togo-framework/tunnel-frp v0.1.0
	github.com/togo-framework/tunnel-ngrok v0.1.0
	github.com/togo-framework/tunnel-tailscale v0.1.0
	github.com/togo-framework/validation v0.1.0
	github.com/togo-framework/webhooks v0.1.1
	github.com/togo-framework/widget v0.1.0
	github.com/togo-framework/widget-availability v0.1.0
	github.com/togo-framework/widget-blog v0.1.0
	github.com/togo-framework/widget-clock v0.1.0
	github.com/togo-framework/widget-contact v0.1.0
	github.com/togo-framework/widget-header v0.1.0
	github.com/togo-framework/widget-notes v0.1.0
	github.com/togo-framework/widget-now v0.1.0
	github.com/togo-framework/widget-opensource v0.1.0
	github.com/togo-framework/widget-profile v0.1.0
	github.com/togo-framework/widget-skills v0.1.0
	github.com/togo-framework/widget-socials v0.1.0
	github.com/togo-framework/widget-sponsor v0.1.0
	github.com/togo-framework/widget-stats v0.1.0
	github.com/togo-framework/widget-tools v0.1.0
	github.com/togo-framework/worker v0.1.0
	github.com/togo-framework/workflow v0.1.0
	github.com/togo-framework/youtube v0.1.0
)

require (
	cloud.google.com/go/auth v0.7.3 // indirect
	cloud.google.com/go/auth/oauth2adapt v0.2.3 // indirect
	cloud.google.com/go/compute/metadata v0.5.0 // indirect
	filippo.io/edwards25519 v1.1.0 // indirect
	github.com/PuerkitoBio/goquery v1.9.3 // indirect
	github.com/SherClockHolmes/webpush-go v1.3.0 // indirect
	github.com/agnivade/levenshtein v1.2.0 // indirect
	github.com/andybalholm/cascadia v1.3.2 // indirect
	github.com/antchfx/htmlquery v1.2.3 // indirect
	github.com/antchfx/xmlquery v1.2.4 // indirect
	github.com/antchfx/xpath v1.1.8 // indirect
	github.com/aws/aws-sdk-go-v2 v1.30.3 // indirect
	github.com/aws/aws-sdk-go-v2/aws/protocol/eventstream v1.6.3 // indirect
	github.com/aws/aws-sdk-go-v2/config v1.27.27 // indirect
	github.com/aws/aws-sdk-go-v2/credentials v1.17.27 // indirect
	github.com/aws/aws-sdk-go-v2/feature/ec2/imds v1.16.11 // indirect
	github.com/aws/aws-sdk-go-v2/internal/configsources v1.3.15 // indirect
	github.com/aws/aws-sdk-go-v2/internal/endpoints/v2 v2.6.15 // indirect
	github.com/aws/aws-sdk-go-v2/internal/ini v1.8.0 // indirect
	github.com/aws/aws-sdk-go-v2/internal/v4a v1.3.15 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/accept-encoding v1.11.3 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/checksum v1.3.17 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/presigned-url v1.11.17 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/s3shared v1.17.15 // indirect
	github.com/aws/aws-sdk-go-v2/service/s3 v1.58.2 // indirect
	github.com/aws/aws-sdk-go-v2/service/sso v1.22.4 // indirect
	github.com/aws/aws-sdk-go-v2/service/ssooidc v1.26.4 // indirect
	github.com/aws/aws-sdk-go-v2/service/sts v1.30.3 // indirect
	github.com/aws/smithy-go v1.20.3 // indirect
	github.com/aymerick/douceur v0.2.0 // indirect
	github.com/beevik/etree v1.1.0 // indirect
	github.com/beorn7/perks v1.0.1 // indirect
	github.com/boombuler/barcode v1.0.1-0.20190219062509-6c824513bacc // indirect
	github.com/bwmarrin/discordgo v0.28.1 // indirect
	github.com/cespare/xxhash/v2 v2.3.0 // indirect
	github.com/chromedp/cdproto v0.0.0-20260321001828-e3e3800016bc // indirect
	github.com/chromedp/chromedp v0.15.1 // indirect
	github.com/chromedp/sysutil v1.1.0 // indirect
	github.com/coder/websocket v1.8.15 // indirect
	github.com/cpuguy83/go-md2man/v2 v2.0.5 // indirect
	github.com/crewjam/saml v0.4.14 // indirect
	github.com/deckarep/golang-set/v2 v2.6.0 // indirect
	github.com/dgryski/go-rendezvous v0.0.0-20200823014737-9f7001d12a5f // indirect
	github.com/digitalocean/godo v1.196.0 // indirect
	github.com/disintegration/imaging v1.6.2 // indirect
	github.com/dustin/go-humanize v1.0.1 // indirect
	github.com/felixge/httpsnoop v1.0.4 // indirect
	github.com/fxamacker/cbor/v2 v2.9.2 // indirect
	github.com/getsentry/sentry-go v0.30.0 // indirect
	github.com/go-jose/go-jose/v3 v3.0.3 // indirect
	github.com/go-json-experiment/json v0.0.0-20260214004413-d219187c3433 // indirect
	github.com/go-logr/logr v1.4.2 // indirect
	github.com/go-logr/stdr v1.2.2 // indirect
	github.com/go-sql-driver/mysql v1.8.1 // indirect
	github.com/go-stack/stack v1.8.1 // indirect
	github.com/go-telegram-bot-api/telegram-bot-api/v5 v5.5.1 // indirect
	github.com/go-viper/mapstructure/v2 v2.5.0 // indirect
	github.com/go-webauthn/webauthn v0.17.4 // indirect
	github.com/go-webauthn/x v0.2.6 // indirect
	github.com/gobwas/glob v0.2.3 // indirect
	github.com/gobwas/httphead v0.1.0 // indirect
	github.com/gobwas/pool v0.2.1 // indirect
	github.com/gobwas/ws v1.4.0 // indirect
	github.com/gocolly/colly/v2 v2.1.0 // indirect
	github.com/golang-jwt/jwt v3.2.2+incompatible // indirect
	github.com/golang-jwt/jwt/v5 v5.3.1 // indirect
	github.com/golang/groupcache v0.0.0-20210331224755-41bb18bfe9da // indirect
	github.com/golang/protobuf v1.5.4 // indirect
	github.com/golang/snappy v0.0.4 // indirect
	github.com/google/go-querystring v1.2.0 // indirect
	github.com/google/go-tpm v0.9.8 // indirect
	github.com/google/s2a-go v0.1.8 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/googleapis/enterprise-certificate-proxy v0.3.2 // indirect
	github.com/googleapis/gax-go/v2 v2.13.0 // indirect
	github.com/gorilla/css v1.0.1 // indirect
	github.com/gorilla/websocket v1.5.0 // indirect
	github.com/hashicorp/go-cleanhttp v0.5.2 // indirect
	github.com/hashicorp/go-retryablehttp v0.7.8 // indirect
	github.com/hashicorp/golang-lru/v2 v2.0.7 // indirect
	github.com/hetznercloud/hcloud-go/v2 v2.10.2 // indirect
	github.com/inconshreveable/log15 v3.0.0-testing.5+incompatible // indirect
	github.com/inconshreveable/log15/v3 v3.0.0-testing.5 // indirect
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	github.com/jonboulle/clockwork v0.2.2 // indirect
	github.com/jpillora/backoff v1.0.0 // indirect
	github.com/json-iterator/go v1.1.12 // indirect
	github.com/kennygrant/sanitize v1.2.4 // indirect
	github.com/klauspost/compress v1.17.10 // indirect
	github.com/mattermost/xml-roundtrip-validator v0.1.0 // indirect
	github.com/mattn/go-colorable v0.1.14 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	github.com/microcosm-cc/bluemonday v1.0.27 // indirect
	github.com/mmcdole/gofeed v1.3.0 // indirect
	github.com/mmcdole/goxpp v1.1.1-0.20240225020742-a0c311522b23 // indirect
	github.com/modern-go/concurrent v0.0.0-20180306012644-bacd9c7ef1dd // indirect
	github.com/modern-go/reflect2 v1.0.2 // indirect
	github.com/mohae/deepcopy v0.0.0-20170929034955-c48cc78d4826 // indirect
	github.com/montanaflynn/stats v0.7.1 // indirect
	github.com/nats-io/nats.go v1.37.0 // indirect
	github.com/nats-io/nkeys v0.4.7 // indirect
	github.com/nats-io/nuid v1.0.1 // indirect
	github.com/ncruces/go-strftime v1.0.0 // indirect
	github.com/philhofer/fwd v1.2.0 // indirect
	github.com/pierrec/lz4/v4 v4.1.15 // indirect
	github.com/playwright-community/playwright-go v0.5101.0 // indirect
	github.com/pquerna/otp v1.4.0 // indirect
	github.com/prometheus/client_golang v1.19.1 // indirect
	github.com/prometheus/client_model v0.5.0 // indirect
	github.com/prometheus/common v0.48.0 // indirect
	github.com/prometheus/procfs v0.12.0 // indirect
	github.com/rabbitmq/amqp091-go v1.10.0 // indirect
	github.com/redis/go-redis/v9 v9.7.0 // indirect
	github.com/remyoudompheng/bigfft v0.0.0-20230129092748-24d4a6f8daec // indirect
	github.com/richardlehane/mscfb v1.0.4 // indirect
	github.com/richardlehane/msoleps v1.0.3 // indirect
	github.com/robfig/cron/v3 v3.0.1 // indirect
	github.com/rogpeppe/go-internal v1.15.0 // indirect
	github.com/russellhaering/goxmldsig v1.3.0 // indirect
	github.com/russross/blackfriday/v2 v2.1.0 // indirect
	github.com/saintfish/chardet v0.0.0-20120816061221-3af4cd4741ca // indirect
	github.com/segmentio/kafka-go v0.4.47 // indirect
	github.com/slack-go/slack v0.15.0 // indirect
	github.com/sosodev/duration v1.3.1 // indirect
	github.com/temoto/robotstxt v1.1.1 // indirect
	github.com/tinylib/msgp v1.6.4 // indirect
	github.com/urfave/cli/v2 v2.27.5 // indirect
	github.com/vultr/govultr/v3 v3.31.2 // indirect
	github.com/x448/float16 v0.8.4 // indirect
	github.com/xdg-go/pbkdf2 v1.0.0 // indirect
	github.com/xdg-go/scram v1.1.2 // indirect
	github.com/xdg-go/stringprep v1.0.4 // indirect
	github.com/xrash/smetrics v0.0.0-20240521201337-686a1a2994c1 // indirect
	github.com/xuri/efp v0.0.0-20231025114914-d1ff6096ae53 // indirect
	github.com/xuri/excelize/v2 v2.8.1 // indirect
	github.com/xuri/nfp v0.0.0-20230919160717-d98342af3f05 // indirect
	github.com/youmark/pkcs8 v0.0.0-20240726163527-a2c0da244d78 // indirect
	github.com/yuin/goldmark v1.7.8 // indirect
	go.mongodb.org/mongo-driver v1.17.1 // indirect
	go.opencensus.io v0.24.0 // indirect
	go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp v0.49.0 // indirect
	go.opentelemetry.io/otel v1.24.0 // indirect
	go.opentelemetry.io/otel/metric v1.24.0 // indirect
	go.opentelemetry.io/otel/trace v1.24.0 // indirect
	go.uber.org/multierr v1.11.0 // indirect
	golang.ngrok.com/muxado/v2 v2.0.1 // indirect
	golang.ngrok.com/ngrok v1.12.1 // indirect
	golang.org/x/crypto v0.52.0 // indirect
	golang.org/x/image v0.14.0 // indirect
	golang.org/x/mod v0.36.0 // indirect
	golang.org/x/net v0.54.0 // indirect
	golang.org/x/oauth2 v0.36.0 // indirect
	golang.org/x/sync v0.20.0 // indirect
	golang.org/x/sys v0.45.0 // indirect
	golang.org/x/term v0.43.0 // indirect
	golang.org/x/text v0.37.0 // indirect
	golang.org/x/time v0.6.0 // indirect
	golang.org/x/tools v0.45.0 // indirect
	google.golang.org/api v0.190.0 // indirect
	google.golang.org/appengine v1.6.8 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20240730163845-b1a4ccb954bf // indirect
	google.golang.org/grpc v1.65.0 // indirect
	google.golang.org/protobuf v1.36.5 // indirect
	gopkg.in/yaml.v2 v2.4.0 // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
	modernc.org/libc v1.73.4 // indirect
	modernc.org/mathutil v1.7.1 // indirect
	modernc.org/memory v1.11.0 // indirect
	rsc.io/qr v0.2.0 // indirect
)
