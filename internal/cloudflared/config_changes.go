package cloudflared

import (
	"bytes"
	"context"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

func reviewedRoute(input IngressRoute) (IngressRoute, error) {
	input.Hostname = strings.ToLower(strings.TrimSuffix(strings.TrimSpace(input.Hostname), "."))
	host := strings.TrimPrefix(input.Hostname, "*.")
	if host == "" || len(input.Hostname) > 253 || len(input.Path) > 1024 || len(input.Service) > 2048 {
		return input, errors.New("use a hostname up to 253 characters, path up to 1024 and origin up to 2048")
	}
	label := regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`)
	for _, part := range strings.Split(host, ".") {
		if !label.MatchString(part) {
			return input, errors.New("use a DNS hostname; only a leading *. wildcard is supported")
		}
	}
	if _, err := regexp.Compile(input.Path); err != nil {
		return input, errors.New("the path expression is invalid")
	}
	origin, err := url.Parse(input.Service)
	if err != nil || (origin.Scheme != "http" && origin.Scheme != "https" && origin.Scheme != "tcp") || (origin.Hostname() == "" || strings.HasSuffix(origin.Host, ":")) || origin.User != nil || origin.RawQuery != "" || origin.Fragment != "" {
		return input, errors.New("use an HTTP(S) or TCP origin without credentials, query or fragment")
	}
	input.Service, input.Protocol, input.CatchAll = origin.String(), origin.Scheme, false
	return input, nil
}

func editableYAML(node *yaml.Node, depth int, remaining *int) error {
	*remaining--
	if depth > 40 || *remaining < 0 || node.Kind == yaml.AliasNode {
		return errors.New("aliases or unusually deep config documents require manual editing")
	}
	if node.Kind == yaml.MappingNode {
		seen := map[string]bool{}
		for index := 0; index+1 < len(node.Content); index += 2 {
			key := node.Content[index]
			if key.Kind != yaml.ScalarNode || seen[key.Value] {
				return errors.New("duplicate or complex config keys require manual editing")
			}
			seen[key.Value] = true
		}
	}
	for _, child := range node.Content {
		if err := editableYAML(child, depth+1, remaining); err != nil {
			return err
		}
	}
	return nil
}

func appendIngress(data []byte, route IngressRoute) ([]byte, error) {
	document, ingress, err := configDocument(data)
	if err != nil {
		return nil, err
	}
	remaining := 10000
	if err := editableYAML(document, 0, &remaining); err != nil {
		return nil, err
	}
	root := document.Content[0]
	for index := 0; index+1 < len(root.Content); index += 2 {
		if root.Content[index].Value == "token" || root.Content[index].Value == "token-file" {
			return nil, errors.New("token-managed configs require the remote-management workflow")
		}
	}
	if len(ingress.Content) == 0 || len(ingress.Content) >= maxRoutes {
		return nil, errors.New("keep between 1 and 255 existing ingress rules before adding one")
	}
	last := ingress.Content[len(ingress.Content)-1]
	if last.Kind != yaml.MappingNode {
		return nil, errors.New("the final ingress rule is not an editable catch-all")
	}
	for index := 0; index+1 < len(last.Content); index += 2 {
		if (last.Content[index].Value == "hostname" || last.Content[index].Value == "path") && last.Content[index+1].Value != "" {
			return nil, errors.New("the final ingress rule must remain a catch-all")
		}
	}
	var node yaml.Node
	if node.Encode(struct {
		Hostname string `yaml:"hostname"`
		Path     string `yaml:"path,omitempty"`
		Service  string `yaml:"service"`
	}{route.Hostname, route.Path, route.Service}) != nil {
		return nil, errors.New("route encoding failed")
	}
	ingress.Content = append(ingress.Content[:len(ingress.Content)-1], &node, last)
	var output bytes.Buffer
	encoder := yaml.NewEncoder(&output)
	encoder.SetIndent(2)
	if err := encoder.Encode(document); err != nil {
		return nil, err
	}
	if err := encoder.Close(); err != nil {
		return nil, err
	}
	if output.Len() > maxConfigBytes {
		return nil, errors.New("the proposed config exceeds 256 KiB")
	}
	return output.Bytes(), nil
}

func (engine *operations) stageValidated(ctx context.Context, executable, target string, data []byte) (string, error) {
	file, err := os.CreateTemp(filepath.Dir(target), ".protopeek-ingress-*.yml")
	if err != nil {
		return "", errors.New("permission-required: the canonical config directory is not writable; no alternate directory is used")
	}
	path := file.Name()
	keep := false
	defer func() {
		_ = file.Close()
		if !keep {
			_ = os.Remove(path)
		}
	}()
	if err := protectStage(path); err != nil {
		return "", err
	}
	if err := file.Chmod(0600); err != nil {
		return "", err
	}
	if _, err := file.Write(data); err != nil {
		return "", err
	}
	if err := file.Sync(); err != nil {
		return "", err
	}
	if err := file.Close(); err != nil {
		return "", err
	}
	if _, err := engine.run(ctx, executable, "tunnel", "--config", path, "ingress", "validate"); err != nil {
		return "", errors.New("native validation refused the proposed file; no canonical config was changed")
	}
	keep = true
	return path, nil
}

func (engine *operations) changeConfig(ctx context.Context, request OperationRequest, observed Observation, config ConfigCandidate) (OperationResult, error) {
	result := OperationResult{Operation: request.Operation, Status: "failed", ObservedAt: engine.now().UTC()}
	if err := engine.allowWrite(config.Path); err != nil {
		result.Status, result.Message = "permission-required", "Only the exact regular, single-link, user-owned writable canonical config can be edited. Administrator-owned, linked and read-only files require the host administrator workflow. No alternate copy is applied."
		return result, nil
	}
	data, info, err := readRegularConfig(config.Path)
	if err != nil || digest(data) != config.Revision {
		result.Status, result.Message = "stale", "Config identity or content changed. Refresh and review again."
		return result, nil
	}
	permissions, permissionErr := configPermissions(config.Path, info)
	if permissionErr != nil {
		result.Status, result.Message = "permission-required", "Config permissions could not be verified."
		return result, nil
	}
	if request.Operation == "plan" {
		for id, state := range engine.plans {
			if engine.now().After(state.view.ExpiresAt) {
				delete(engine.plans, id)
			}
		}
		if len(engine.plans) >= 4 {
			result.Message = "Four config plans are retained. Wait for a plan to expire before creating another."
			return result, nil
		}
		route, err := reviewedRoute(request.Route)
		if err != nil {
			result.Message = err.Error()
			return result, nil
		}
		candidate, err := appendIngress(data, route)
		if err != nil {
			result.Message = err.Error()
			return result, nil
		}
		if _, err := engine.run(ctx, observed.Cloudflared.Path, "tunnel", "--config", config.Path, "ingress", "validate"); err != nil {
			result.Message = "The current file does not pass native validation. Edit it locally before planning a change."
			return result, nil
		}
		stage, err := engine.stageValidated(ctx, observed.Cloudflared.Path, config.Path, candidate)
		if err != nil {
			result.Message = err.Error()
			return result, nil
		}
		_ = os.Remove(stage)
		if err := engine.unchanged(ctx, observed, config); err != nil {
			result.Status, result.Message = "stale", err.Error()
			return result, nil
		}
		id := randomID()
		if id == "" {
			return result, errors.New("could not create a private plan identity")
		}
		state := &configPlanState{view: ConfigPlan{ID: id, Path: config.Path, Before: config.Revision, After: digest(candidate), Route: route, ExpiresAt: engine.now().Add(10 * time.Minute)}, original: data, candidate: candidate, identity: info, authority: serviceIdentity(observed), permissions: permissions}
		engine.plans[id] = state
		view := state.view
		result.Plan = &view
		result.Status, result.Message = "planned", "One route will be inserted before the catch-all. Other YAML settings stay on the host. Native validation passed; no canonical file or service was changed."
		return result, nil
	}
	state := engine.plans[request.PlanID]
	if state == nil || engine.now().After(state.view.ExpiresAt) {
		result.Status, result.Message = "stale", "The private plan expired or this process restarted. Preview a new plan; rollback bytes are not stored in the browser."
		return result, nil
	}
	if !samePath(state.view.Path, config.Path) || state.authority != serviceIdentity(observed) || !os.SameFile(state.identity, info) || state.permissions != permissions {
		result.Status, result.Message = "stale", "Canonical file or service identity changed. No file was replaced."
		return result, nil
	}
	wanted, expected := state.candidate, state.view.Before
	if request.Operation == "rollback" {
		if !state.view.Applied {
			result.Message = "This plan has no applied file to roll back."
			return result, nil
		}
		wanted, expected = state.original, state.view.After
	} else if state.view.Applied {
		result.Message = "This plan was already applied. Refresh before another change."
		return result, nil
	}
	if digest(data) != expected {
		result.Status, result.Message = "stale", "The current file differs from this plan. No unrelated edit was overwritten."
		return result, nil
	}
	stage, err := engine.stageValidated(ctx, observed.Cloudflared.Path, config.Path, wanted)
	if err != nil {
		result.Message = err.Error()
		return result, nil
	}
	defer os.Remove(stage)
	if err := preserveConfigPermissions(stage, config.Path, info); err != nil {
		result.Status, result.Message = "permission-required", "The original config permissions could not be preserved. No canonical file was changed."
		return result, nil
	}
	stagedInfo, stagedErr := os.Stat(stage)
	stagedPermissions := ""
	if stagedErr == nil {
		stagedPermissions, stagedErr = configPermissions(stage, stagedInfo)
	}
	if stagedErr != nil || stagedPermissions != state.permissions {
		result.Status, result.Message = "permission-required", "The staged file does not preserve the canonical permissions. No file was changed."
		return result, nil
	}
	if err := engine.unchanged(ctx, observed, config); err != nil {
		result.Status, result.Message = "stale", err.Error()
		return result, nil
	}
	latest, latestInfo, err := readRegularConfig(config.Path)
	if err != nil || !os.SameFile(info, latestInfo) || digest(latest) != expected {
		result.Status, result.Message = "stale", "Config changed immediately before replacement. No file was replaced."
		return result, nil
	}
	latestPermissions, permissionErr := configPermissions(config.Path, latestInfo)
	if permissionErr != nil || latestPermissions != state.permissions || engine.allowWrite(config.Path) != nil {
		result.Status, result.Message = "stale", "Canonical file permissions changed. Refresh and review again."
		return result, nil
	}
	if err := ctx.Err(); err != nil {
		return result, err
	}
	committed, commitErr := replaceConfigFile(stage, config.Path)
	after, afterInfo, readErr := readRegularConfig(config.Path)
	if readErr != nil || digest(after) != digest(wanted) {
		result.Message = "File replacement could not be verified. Inspect the canonical file before retrying; no success was assumed."
		result.Receipt = &OperationReceipt{ID: randomID(), Operation: request.Operation, Status: "unverified", Before: expected, ObservedAt: engine.now().UTC()}
		return result, nil
	}
	if !committed && commitErr != nil {
		result.Message = "The target changed despite a native replacement error. Inspect it locally before any further operation."
		return result, nil
	}
	state.identity = afterInfo
	state.view.Applied = request.Operation == "apply"
	verify, stop := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer stop()
	_, validateErr := engine.run(verify, observed.Cloudflared.Path, "tunnel", "--config", config.Path, "ingress", "validate")
	if validateErr != nil && request.Operation == "apply" {
		if engine.restoreAfterFailure(verify, observed, config, state) == nil {
			result.Status, result.Message = "rolled-back", "Post-write validation failed. The unchanged applied file was restored and the original config passed native validation."
		} else {
			result.Status, result.Message = "rollback-required", "Post-write validation failed and automatic rollback could not be verified. Inspect the canonical file; unrelated changes were not overwritten."
		}
	} else if validateErr != nil {
		result.Status, result.Message = "rollback-unverified", "The original bytes were restored, but post-rollback native validation did not complete. Inspect locally before restarting."
	} else {
		result.Status, result.Message = "completed", "The canonical file was replaced and native validation passed. The running service was not restarted; verify deployment separately."
	}
	if commitErr != nil {
		result.Message += " Directory durability could not be confirmed."
	}
	after, _, readErr = readRegularConfig(config.Path)
	finalHash := ""
	if readErr == nil {
		finalHash = digest(after)
	}
	view := state.view
	result.Plan = &view
	result.Receipt = &OperationReceipt{ID: randomID(), Operation: request.Operation, Status: result.Status, Before: expected, After: finalHash, ObservedAt: engine.now().UTC()}
	return result, nil
}

func (engine *operations) restoreAfterFailure(ctx context.Context, observed Observation, config ConfigCandidate, state *configPlanState) error {
	current, info, err := readRegularConfig(config.Path)
	if err != nil || !os.SameFile(info, state.identity) || digest(current) != state.view.After {
		return errors.New("applied file changed")
	}
	config.Revision = state.view.After
	if err := engine.unchanged(ctx, observed, config); err != nil {
		return err
	}
	stage, err := engine.stageValidated(ctx, observed.Cloudflared.Path, config.Path, state.original)
	if err != nil {
		return err
	}
	defer os.Remove(stage)
	if err := preserveConfigPermissions(stage, config.Path, info); err != nil {
		return err
	}
	stagedInfo, stagedErr := os.Stat(stage)
	stagedPermissions := ""
	if stagedErr == nil {
		stagedPermissions, stagedErr = configPermissions(stage, stagedInfo)
	}
	if stagedErr != nil || stagedPermissions != state.permissions {
		return errors.New("rollback permissions could not be preserved")
	}
	latest, latestInfo, err := readRegularConfig(config.Path)
	if err != nil || !os.SameFile(info, latestInfo) || digest(latest) != state.view.After {
		return errors.New("applied file changed")
	}
	permissions, permissionErr := configPermissions(config.Path, latestInfo)
	if permissionErr != nil || permissions != state.permissions || engine.allowWrite(config.Path) != nil {
		return errors.New("canonical file permissions changed")
	}
	committed, commitErr := replaceConfigFile(stage, config.Path)
	if !committed {
		return commitErr
	}
	contents, restoredInfo, err := readRegularConfig(config.Path)
	if err != nil || digest(contents) != state.view.Before {
		return errors.New("rollback could not be verified")
	}
	state.view.Applied, state.identity = false, restoredInfo
	if _, err := engine.run(ctx, observed.Cloudflared.Path, "tunnel", "--config", config.Path, "ingress", "validate"); err != nil {
		return err
	}
	return commitErr
}
