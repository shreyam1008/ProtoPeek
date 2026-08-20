SHELL := /bin/sh

dev_build_version=$(shell git describe --tags --always --dirty 2>/dev/null || echo dev)

export PATH := $(shell pwd)/.tmp/protoc/bin:$(PATH)
export PROTOC_VERSION := 22.0
export CGO_ENABLED=0
export GOFLAGS=-trimpath
export GOWORK=off

.PHONY: ci
ci: checkgofmt vet staticcheck ineffassign predeclared test ui-test ui-build

.PHONY: deps
deps:
	go mod download

.PHONY: ui-deps
ui-deps:
	bun install --frozen-lockfile

.PHONY: ui-build
ui-build:
	bun run build

.PHONY: ui-test
ui-test:
	bun run test

.PHONY: install
install:
	go install -ldflags '-X "main.version=dev build $(dev_build_version)"' ./cmd/protopeek
	go install -ldflags '-X "main.version=dev build $(dev_build_version)"' ./cmd/pp

GORELEASER_VERSION := v2.17.1
TOOLS_BIN := $(CURDIR)/.tmp/tools

.PHONY: release-snapshot
release-snapshot:
	@command -v syft >/dev/null || { echo "syft is required for release SBOMs" >&2; exit 1; }
	go run github.com/goreleaser/goreleaser/v2@$(GORELEASER_VERSION) check --config .goreleaser.yml
	go run github.com/goreleaser/goreleaser/v2@$(GORELEASER_VERSION) check --config .goreleaser.edge.yml
	go run github.com/goreleaser/goreleaser/v2@$(GORELEASER_VERSION) release --snapshot --clean --config .goreleaser.yml

.PHONY: docker
docker:
	docker build --build-arg VERSION=$(dev_build_version) -t protopeek:dev .

.PHONY: generate
generate: .tmp/protoc/bin/protoc
	@go install google.golang.org/protobuf/cmd/protoc-gen-go@a709e31e5d12
	@go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@v1.1.0
	@go install github.com/jhump/protoreflect/desc/sourceinfo/cmd/protoc-gen-gosrcinfo@v1.14.1
	go generate ./...
	go mod tidy

.PHONY: checkgenerate
checkgenerate: generate
	git status --porcelain -- '**/*.go'
	@if [ -n "$$(git status --porcelain -- '**/*.go')" ]; then \
		git diff -- '**/*.go'; \
		exit 1; \
	fi

.PHONY: checkgofmt
checkgofmt:
	@git ls-files --cached --others --exclude-standard -- '*.go' | xargs gofmt -s -w
	@if [ -n "$$(git ls-files --cached --others --exclude-standard -- '*.go' | xargs gofmt -s -l)" ]; then \
		git diff; \
		exit 1; \
	fi

.PHONY: vet
vet:
	go vet ./...

.PHONY: staticcheck
staticcheck:
	@mkdir -p $(TOOLS_BIN)
	@GOBIN=$(TOOLS_BIN) go install honnef.co/go/tools/cmd/staticcheck@2025.1.1
	$(TOOLS_BIN)/staticcheck -checks "inherit,-SA1019" ./...

.PHONY: ineffassign
ineffassign:
	@mkdir -p $(TOOLS_BIN)
	@GOBIN=$(TOOLS_BIN) go install github.com/gordonklaus/ineffassign@v0.2.0
	$(TOOLS_BIN)/ineffassign .

.PHONY: predeclared
predeclared:
	@mkdir -p $(TOOLS_BIN)
	@GOBIN=$(TOOLS_BIN) go install github.com/nishanths/predeclared@v0.2.3-0.20250331095553-51e8c974458a
	$(TOOLS_BIN)/predeclared ./...

.PHONY: test
test:
	CGO_ENABLED=1 go test ./...

.tmp/protoc/bin/protoc: ./Makefile ./download_protoc.sh
	./download_protoc.sh
