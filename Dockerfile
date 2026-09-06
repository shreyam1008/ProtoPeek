# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3.10-alpine AS web-builder
WORKDIR /src
COPY package.json bun.lock biome.json ./
COPY web/console ./web/console
COPY web/src/console ./web/src/console
COPY web/src/design ./web/src/design
COPY web/src/features ./web/src/features
COPY web/src/shared ./web/src/shared
COPY web/src/vite-env.d.ts ./web/src/vite-env.d.ts
COPY web/tsconfig.json ./web/tsconfig.json
COPY web/vite.console.config.ts ./web/vite.console.config.ts
COPY web/vite.console-chunks.ts ./web/vite.console-chunks.ts
COPY web/vite.shared.ts ./web/vite.shared.ts
COPY web/vite.html.ts ./web/vite.html.ts
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile
RUN bun run build:app

FROM golang:1.26-alpine AS go-builder
WORKDIR /src
ARG VERSION=docker
RUN addgroup -S protopeek && adduser -S -D -u 10001 protopeek -G protopeek

COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download

COPY *.go ./
COPY cmd ./cmd
COPY internal ./internal
COPY standalone ./standalone
COPY --from=web-builder /src/internal/resources/app/dist ./internal/resources/app/dist

ENV CGO_ENABLED=0
ENV GOFLAGS="-trimpath -buildvcs=false"
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go build -ldflags "-s -w -buildid= -X main.version=${VERSION}" -o /out/protopeek ./cmd/protopeek

FROM scratch
WORKDIR /
COPY --from=go-builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=go-builder /etc/passwd /etc/passwd
COPY --from=go-builder /out/protopeek /bin/protopeek
COPY --from=go-builder /out/protopeek /bin/pp
COPY LICENSE /licenses/protopeek/LICENSE
COPY THIRD_PARTY_NOTICES.md /licenses/protopeek/THIRD_PARTY_NOTICES.md
USER protopeek
EXPOSE 8080

ENTRYPOINT ["/bin/protopeek", "-bind=0.0.0.0", "-allow-non-loopback-bind", "-port=8080", "-open-browser=false"]
