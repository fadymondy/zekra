# Zekra API for Hosbah (build context: the repo root). The generated sqlc/gqlgen code is not
# committed, so it is generated here. The console is the Next app in web/ (web/Dockerfile), so
# this image serves only the API, MCP and gRPC. The schema is still migrated by hand before a
# binary that needs it ships (DEPLOY.md, "schema before binary").
FROM golang:1.26 AS api
COPY --from=sqlc/sqlc:1.31.1 /workspace/sqlc /usr/local/bin/sqlc
WORKDIR /src
# go.mod replaces the togo plugins with ./plugins/*, so the whole tree is needed before download.
COPY . .
RUN go mod download
RUN sqlc generate && go run github.com/99designs/gqlgen generate
RUN CGO_ENABLED=0 go build -o /out/zekra ./cmd/api

FROM gcr.io/distroless/static-debian12
WORKDIR /app
COPY --from=api /out/zekra /app/zekra
COPY lang/ /app/lang/
ENV ADDR=:8080
EXPOSE 8080 50051
ENTRYPOINT ["/app/zekra"]
