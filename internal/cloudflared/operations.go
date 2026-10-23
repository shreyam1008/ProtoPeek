package cloudflared

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"
)

type OperationRequest struct {
	Operation  string       `json:"operation"`
	ConfigPath string       `json:"configPath"`
	Revision   string       `json:"revision"`
	URL        string       `json:"url"`
	Route      IngressRoute `json:"route"`
	PlanID     string       `json:"planId"`
	Confirmed  bool         `json:"confirmed"`
}
type ConfigPlan struct {
	ID        string       `json:"id"`
	Path      string       `json:"path"`
	Before    string       `json:"beforeRevision"`
	After     string       `json:"afterRevision"`
	Route     IngressRoute `json:"route"`
	ExpiresAt time.Time    `json:"expiresAt"`
	Applied   bool         `json:"applied"`
}
type OperationReceipt struct {
	ID         string    `json:"id"`
	Operation  string    `json:"operation"`
	Status     string    `json:"status"`
	Before     string    `json:"beforeRevision"`
	After      string    `json:"afterRevision"`
	ObservedAt time.Time `json:"observedAt"`
}
type OperationResult struct {
	Operation  string            `json:"operation"`
	Status     string            `json:"status"`
	Message    string            `json:"message"`
	ObservedAt time.Time         `json:"observedAt"`
	Plan       *ConfigPlan       `json:"plan,omitempty"`
	Receipt    *OperationReceipt `json:"receipt,omitempty"`
	Data       any               `json:"data,omitempty"`
}
type configPlanState struct {
	view                ConfigPlan
	original, candidate []byte
	identity            os.FileInfo
	authority           string
	permissions         string
}
type operations struct {
	mu         sync.Mutex
	observe    func(context.Context) (Observation, error)
	run        func(context.Context, string, ...string) ([]byte, error)
	allowWrite func(string) error
	now        func() time.Time
	plans      map[string]*configPlanState
}

func newOperations(observe func(context.Context) (Observation, error)) *operations {
	return &operations{observe: observe, run: runOperation, allowWrite: ownedWritableConfig, now: time.Now, plans: map[string]*configPlanState{}}
}
func (inspector *Inspector) Operation(ctx context.Context, request OperationRequest) (OperationResult, error) {
	if inspector.operations == nil {
		return OperationResult{Operation: request.Operation, Status: "unavailable", Message: "Canonical operations are unavailable in this runtime."}, nil
	}
	return inspector.operations.execute(ctx, request)
}
func digest(contents []byte) string {
	hash := sha256.Sum256(contents)
	return hex.EncodeToString(hash[:])
}
func randomID() string {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return ""
	}
	return hex.EncodeToString(bytes[:])
}

func (engine *operations) execute(parent context.Context, request OperationRequest) (OperationResult, error) {
	result := OperationResult{Operation: request.Operation, Status: "failed", ObservedAt: engine.now().UTC()}
	if len(request.ConfigPath) > 4096 || len(request.Revision) != 64 || len(request.URL) > 2048 || len(request.PlanID) > 64 {
		result.Message = "Choose an observed canonical config and its current revision."
		return result, nil
	}
	switch request.Operation {
	case "validate", "match", "logs", "metrics", "report", "plan", "apply", "rollback":
	default:
		result.Message = "Unsupported canonical operation."
		return result, nil
	}
	if (request.Operation == "apply" || request.Operation == "rollback") && !request.Confirmed {
		result.Message = "Review the plan and confirm this file change."
		return result, nil
	}
	engine.mu.Lock()
	defer engine.mu.Unlock()
	ctx, cancel := context.WithTimeout(parent, 20*time.Second)
	defer cancel()
	observed, err := engine.observe(ctx)
	if err != nil {
		return result, err
	}
	config, err := canonicalConfig(observed, request.ConfigPath, request.Revision)
	if err != nil {
		result.Status, result.Message = "stale", err.Error()
		return result, nil
	}
	if err := ctx.Err(); err != nil {
		return result, err
	}
	switch request.Operation {
	case "plan", "apply", "rollback":
		return engine.changeConfig(ctx, request, observed, config)
	case "logs":
		return engine.logSummary(ctx, request, observed, config)
	case "metrics":
		return engine.metrics(ctx, request, observed, config)
	case "report":
		result.Status, result.Message = "completed", "Sanitized ProtoPeek report prepared. Raw vendor archives, logs, configuration contents and profiles are excluded."
		result.Data = map[string]any{"format": "protopeek-cloudflare-evidence", "version": 1, "observedAt": result.ObservedAt, "cloudflaredVersion": observed.Cloudflared.Version, "service": map[string]any{"manager": observed.Service.Manager, "state": observed.Service.State}, "config": map[string]any{"revision": config.Revision, "binding": config.ServiceBinding, "routeCount": len(config.Routes), "catchAll": config.CatchAllPresent}}
		return result, nil
	}
	args := []string{"tunnel", "--config", config.Path, "ingress", "validate"}
	if request.Operation == "match" {
		value, err := url.Parse(request.URL)
		if err != nil || (value.Scheme != "https" && value.Scheme != "http") || value.Hostname() == "" || value.User != nil {
			result.Message = "Enter an absolute HTTP(S) URL without credentials."
			return result, nil
		}
		value.RawQuery, value.Fragment = "", ""
		args = []string{"tunnel", "--config", config.Path, "ingress", "rule", value.String()}
	}
	output, runErr := engine.run(ctx, observed.Cloudflared.Path, args...)
	if ctx.Err() != nil {
		return result, ctx.Err()
	}
	if runErr != nil {
		result.Message = "Native ingress validation failed. Inspect the configuration locally; native output is withheld because it can include private values."
		return result, nil
	}
	if err := engine.unchanged(ctx, observed, config); err != nil {
		result.Status, result.Message = "stale", err.Error()
		return result, nil
	}
	if request.Operation == "match" {
		matches := regexp.MustCompile(`(?m)^Matched rule #(\d+)\s*$`).FindAllSubmatch(output, 2)
		var match [][]byte
		if len(matches) == 1 {
			match = matches[0]
		}
		var index int
		if len(match) != 2 || json.Unmarshal(match[1], &index) != nil || index < 0 || index >= len(config.Routes) {
			result.Status, result.Message = "unsupported", "Native matching output did not identify a retained rule. No match was guessed."
			return result, nil
		}
		result.Data = map[string]any{"ruleIndex": index, "rule": config.Routes[index]}
	}
	result.Status, result.Message = "completed", "The installed cloudflared command completed against the unchanged canonical config. This does not verify origin or public reachability."
	return result, nil
}

func canonicalConfig(observed Observation, path, revision string) (ConfigCandidate, error) {
	if !observed.Service.Present || !observed.Service.argumentsObserved || !observed.Cloudflared.Found || !filepath.IsAbs(observed.Service.ExecutablePath) || !samePath(observed.Service.ExecutablePath, observed.Cloudflared.Path) || serviceUsesRemoteToken(observed.Service) {
		return ConfigCandidate{}, errors.New("A locally managed canonical service, executable and config binding must be observed first.")
	}
	for _, config := range observed.Configs {
		if samePath(config.Path, path) && config.BoundToCanonicalService && config.Exists && config.Readable && config.Regular && !config.Symlink {
			if config.Revision != revision {
				return ConfigCandidate{}, errors.New("The config changed after observation. Refresh and review again.")
			}
			data, _, readErr := readRegularConfig(config.Path)
			if readErr != nil || digest(data) != revision {
				return ConfigCandidate{}, errors.New("Canonical config content or file identity changed. Refresh before retrying.")
			}
			return config, nil
		}
	}
	return ConfigCandidate{}, errors.New("This path is not the observed canonical service config. User copies and remote-managed configs are not substituted.")
}
func serviceIdentity(observed Observation) string {
	encoded, _ := json.Marshal([]any{observed.Service.Manager, observed.Service.Label, observed.Service.ExecutablePath, observed.Service.ConfigPath, observed.Service.CredentialSource, observed.Service.LogFile, observed.Service.Metrics, observed.Cloudflared.Path})
	return digest(encoded)
}
func (engine *operations) unchanged(ctx context.Context, expected Observation, config ConfigCandidate) error {
	current, err := engine.observe(ctx)
	if err != nil {
		return err
	}
	if _, err := canonicalConfig(current, config.Path, config.Revision); err != nil {
		return err
	}
	if serviceIdentity(expected) != serviceIdentity(current) {
		return errors.New("Canonical service authority changed. Refresh and review again.")
	}
	return nil
}

func readRegularConfig(path string) ([]byte, os.FileInfo, error) {
	if !filepath.IsAbs(path) || strings.HasPrefix(path, `\\`) {
		return nil, nil, errors.New("canonical paths must be absolute")
	}
	if err := noLinksInPath(path); err != nil {
		return nil, nil, err
	}
	before, err := os.Lstat(path)
	if err != nil || !before.Mode().IsRegular() {
		return nil, nil, errors.New("config is not a regular file")
	}
	if err := singleLink(path, before); err != nil {
		return nil, nil, err
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, nil, err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !os.SameFile(before, opened) {
		return nil, nil, errors.New("config identity changed while opening")
	}
	data, err := io.ReadAll(io.LimitReader(file, maxConfigBytes+1))
	if err != nil || len(data) > maxConfigBytes {
		return nil, nil, errors.New("config is unreadable or exceeds 256 KiB")
	}
	return data, opened, nil
}
func noLinksInPath(path string) error {
	current := filepath.Clean(path)
	for {
		info, err := os.Lstat(current)
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 || isReparse(info) {
			return errors.New("symlink or reparse paths are not adopted")
		}
		parent := filepath.Dir(current)
		if parent == current {
			return nil
		}
		current = parent
	}
}
func configDocument(data []byte) (*yaml.Node, *yaml.Node, error) {
	var document yaml.Node
	decoder := yaml.NewDecoder(strings.NewReader(string(data)))
	if decoder.Decode(&document) != nil || len(document.Content) != 1 || document.Content[0].Kind != yaml.MappingNode {
		return nil, nil, errors.New("config must be one YAML mapping")
	}
	var extra yaml.Node
	if decoder.Decode(&extra) != io.EOF {
		return nil, nil, errors.New("multiple YAML documents are unsupported")
	}
	root := document.Content[0]
	for index := 0; index+1 < len(root.Content); index += 2 {
		if root.Content[index].Value == "ingress" && root.Content[index+1].Kind == yaml.SequenceNode {
			return &document, root.Content[index+1], nil
		}
	}
	return nil, nil, errors.New("the canonical config has no editable ingress sequence")
}
