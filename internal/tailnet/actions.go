package tailnet

import (
	"context"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type ActionRequest struct {
	Action   string `json:"action"`
	Target   string `json:"target"`
	Path     string `json:"path"`
	Revision string `json:"revision"`
	Consent  bool   `json:"consent"`
}

type ActionResult struct {
	Action            string    `json:"action"`
	Arguments         []string  `json:"arguments"`
	Output            string    `json:"output"`
	ObservedAt        string    `json:"observedAt"`
	Outcome           string    `json:"outcome"`
	Snapshot          *Snapshot `json:"snapshot,omitempty"`
	PreviousProfileID string    `json:"previousProfileId,omitempty"`
}

func actionArguments(input ActionRequest, current Snapshot) ([]string, error) {
	if !input.Consent {
		return nil, errors.New("review and confirm this Tailscale operation before running it")
	}
	if !current.Available || current.Revision == "" || input.Revision != current.Revision {
		return nil, errors.New("tailscale state changed; refresh and review the operation again")
	}
	maxTarget := 128
	if input.Action == "login-server" {
		maxTarget = 2048
	}
	if len(input.Target) > maxTarget || len(input.Path) > 4096 {
		return nil, errors.New("tailscale target or path is too long")
	}
	peerTarget := func(requireExit, requireFile bool) (string, error) {
		for _, peer := range current.Peers {
			if peer.ID != input.Target || len(peer.IPs) == 0 {
				continue
			}
			if requireExit && !peer.ExitNodeOption {
				return "", errors.New("this peer is not currently an exit-node option")
			}
			if requireFile && !peer.TaildropAvailable {
				return "", errors.New("the installed client does not report this peer as a Taildrop recipient")
			}
			return peer.IPs[0], nil
		}
		return "", errors.New("choose a peer from the current Tailscale snapshot")
	}
	if input.Action != "send-file" && input.Action != "receive-files" && input.Path != "" {
		return nil, errors.New("this operation does not accept a file path")
	}
	switch input.Action {
	case "login-server":
		server, err := url.Parse(input.Target)
		if err != nil || server.Scheme != "https" || server.Hostname() == "" || strings.HasSuffix(server.Host, ":") || server.User != nil || server.RawQuery != "" || server.Fragment != "" {
			return nil, errors.New("enter an HTTPS control-server URL without credentials, query or fragment")
		}
		if !current.AccountsObserved {
			return nil, errors.New("the saved account list must be observed before adding a separate control-server account")
		}
		selected := false
		for _, profile := range current.Profiles {
			if profile.Selected {
				selected = true
			}
		}
		if len(current.Profiles) > 0 && !selected {
			return nil, errors.New("the current saved account is unknown; inspect again before adding another")
		}
		return []string{"login", "--login-server=" + server.String(), "--timeout=30s"}, nil
	case "connect", "disconnect", "logout", "clear-exit", "advertise-exit", "stop-advertising-exit", "netcheck":
		if input.Target != "" {
			return nil, errors.New("this operation does not accept a target")
		}
		switch input.Action {
		case "connect":
			return []string{"up", "--timeout=30s"}, nil
		case "disconnect":
			return []string{"down"}, nil
		case "logout":
			return []string{"logout"}, nil
		case "clear-exit":
			return []string{"set", "--exit-node="}, nil
		case "advertise-exit":
			return []string{"set", "--advertise-exit-node=true"}, nil
		case "stop-advertising-exit":
			return []string{"set", "--advertise-exit-node=false"}, nil
		case "netcheck":
			return []string{"netcheck"}, nil
		}
	case "switch":
		for _, profile := range current.Profiles {
			if profile.ID == input.Target && profile.ID != "" && !strings.HasPrefix(profile.ID, "-") {
				return []string{"switch", profile.ID}, nil
			}
		}
		return nil, errors.New("choose an account from the current snapshot")
	case "exit-node", "ping", "send-file":
		target, err := peerTarget(input.Action == "exit-node", input.Action == "send-file")
		if err != nil {
			return nil, err
		}
		switch input.Action {
		case "exit-node":
			return []string{"set", "--exit-node=" + target}, nil
		case "ping":
			return []string{"ping", "--c=3", "--timeout=3s", "--until-direct=false", target}, nil
		case "send-file":
			if !filepath.IsAbs(input.Path) {
				return nil, errors.New("choose an absolute path to one local regular file")
			}
			info, err := os.Lstat(input.Path)
			if err != nil {
				return nil, err
			}
			if !info.Mode().IsRegular() {
				return nil, errors.New("taildrop sends one regular file; directory links are not sent")
			}
			return []string{"file", "cp", filepath.Clean(input.Path), target + ":"}, nil
		}
	case "receive-files":
		if input.Target != "" || !filepath.IsAbs(input.Path) {
			return nil, errors.New("choose an absolute local destination directory")
		}
		info, err := os.Lstat(input.Path)
		if err != nil {
			return nil, err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return nil, errors.New("choose an existing directory, not a directory link")
		}
		return []string{"file", "get", "--conflict=rename", filepath.Clean(input.Path)}, nil
	}
	return nil, errors.New("unsupported Tailscale operation")
}

func (service *Service) Execute(parent context.Context, input ActionRequest) (ActionResult, error) {
	result := ActionResult{Action: input.Action}
	if !input.Consent || input.Revision == "" {
		return result, errors.New("review and confirm the current Tailscale operation before running it")
	}
	commandLimit := 35 * time.Second
	if input.Action == "send-file" || input.Action == "receive-files" {
		commandLimit = 5 * time.Minute
	}
	ctx, cancel := context.WithTimeout(parent, commandLimit+15*time.Second)
	defer cancel()
	current, err := service.Inspect(ctx)
	if err != nil {
		return result, err
	}
	args, err := actionArguments(input, current)
	if err != nil {
		return result, err
	}
	result.Arguments = args
	for _, profile := range current.Profiles {
		if profile.Selected {
			result.PreviousProfileID = profile.ID
			break
		}
	}
	commandCtx, stop := context.WithTimeout(ctx, commandLimit)
	defer stop()
	output, err := service.Run(commandCtx, current.Path, args...)
	observe, done := context.WithTimeout(context.WithoutCancel(parent), 10*time.Second)
	if snapshot, inspectErr := service.Inspect(observe); inspectErr == nil {
		result.Snapshot = &snapshot
	}
	done()
	result.Outcome = "completed"
	result.ObservedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if err != nil {
		result.Outcome = "failed"
		result.Output = actionFailureOutput(err)
		if errors.Is(commandCtx.Err(), context.Canceled) {
			result.Outcome = "cancelled"
		} else if errors.Is(commandCtx.Err(), context.DeadlineExceeded) || errors.Is(err, context.DeadlineExceeded) {
			result.Output = "The native command exceeded its time limit. A daemon change may already have occurred; inspect the resulting state before trying again."
		}
		if input.Action == "login-server" {
			result.Output = "The native login did not complete within its bounded attempt. Open Tailscale on this computer, or use the reviewed native terminal command to receive the private browser or Headscale registration link. Complete sign-in there, then refresh. Accounts may have changed; ProtoPeek never retains sign-in links or keys."
			return result, nil
		}
		return result, errors.New(result.Output)
	}
	result.Output = text(string(output), 16<<10)
	if input.Action == "login-server" {
		result.Output = "The installed client completed login. Inspect the selected account below. Previous accounts were not reset; switch back when needed."
	}
	if result.Output == "" {
		result.Output = "The installed client completed the operation. Refresh to observe the resulting state."
	}
	result.ObservedAt = time.Now().UTC().Format(time.RFC3339Nano)
	return result, nil
}

func actionFailureOutput(err error) string {
	reason := "The CLI did not complete."
	native := strings.ToLower(err.Error())
	switch {
	case strings.Contains(native, "permission denied") || strings.Contains(native, "access is denied") || strings.Contains(native, "access denied"):
		reason = "The native client reported a permission restriction. Complete required authorization in Tailscale."
	case strings.Contains(native, "not allowed") || strings.Contains(native, "not permitted") || strings.Contains(native, "policy"):
		reason = "The native client reported a policy restriction. Check the tailnet policy with its administrator."
	case strings.Contains(native, "not logged in") || strings.Contains(native, "requires login") || strings.Contains(native, "needslogin") || strings.Contains(native, "authentication required"):
		reason = "The native client requires sign-in. Complete sign-in in Tailscale."
	}
	return reason + " A daemon change may already have occurred; inspect the resulting state before trying again."
}
