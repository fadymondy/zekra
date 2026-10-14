# Zekra API plus the zekractl ops tool, for docker-compose.selfhost.yml. Same build as the root
# Dockerfile (which ships the API alone); zekractl applies the schema in the one-shot migrate job.
FROM golang:1.26 AS build
COPY --from=sqlc/sqlc:1.31.1 /workspace/sqlc /usr/local/bin/sqlc
WORKDIR /src
ENV GOFLAGS=-mod=mod
COPY . .
RUN go mod download
RUN sqlc generate && go run github.com/99designs/gqlgen generate
RUN CGO_ENABLED=0 go build -o /out/zekra ./cmd/api \
 && CGO_ENABLED=0 go build -o /out/zekractl ./cmd/zekractl

FROM gcr.io/distroless/static-debian12
WORKDIR /app
COPY --from=build /out/zekra /app/zekra
COPY --from=build /out/zekractl /app/zekractl
COPY lang/ /app/lang/
ENV ADDR=:8080
EXPOSE 8080 50051
ENTRYPOINT ["/app/zekra"]
