package publishsession

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"strings"
	"sync"
	"time"
)

type child interface {
	Wait() error
	Kill() error
	PID() int
}
type startChild func(context.Context, string, []string, io.Writer) (child, error)
type owned struct {
	Session
	prepared           prepared
	cancel             context.CancelFunc
	scope              context.Context
	child              child
	done               chan struct{}
	ready              chan struct{}
	readyOnce          sync.Once
	registered         bool
	processUnconfirmed bool
	config             string
	directory          string
	bytes              int
	pending            []byte
}
type issuedPreview struct {
	value    Preview
	prepared prepared
}

type Supervisor struct {
	mu            sync.Mutex
	ctx           context.Context
	cancel        context.CancelFunc
	closed        bool
	starting      bool
	preview       *issuedPreview
	current       *owned
	find          func(string) (string, error)
	run           func(context.Context, string, ...string) ([]byte, error)
	start         startChild
	probe         func(context.Context, string) OriginObservation
	verify        func(context.Context, string) (int, error)
	startupLimit  time.Duration
	lifetimeLimit time.Duration
}

func New() *Supervisor {
	ctx, cancel := context.WithCancel(context.Background())
	return &Supervisor{ctx: ctx, cancel: cancel, find: findTool, run: runCommand, start: launch, probe: probeOrigin, verify: verifyEndpoint, startupLimit: 15 * time.Second}
}
func randomID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", publicError("unable to allocate session identity")
	}
	return hex.EncodeToString(value[:]), nil
}
func active(state string) bool {
	return state == "starting" || state == "running" || state == "stopping"
}
func blocksNew(value *owned) bool {
	return value != nil && (active(value.State) || value.Cleanup == "unconfirmed")
}

func (s *Supervisor) Preview(ctx context.Context, request Request) (Preview, error) {
	s.mu.Lock()
	blocked := s.closed || s.starting || blocksNew(s.current)
	s.mu.Unlock()
	if blocked {
		return Preview{}, publicError("stop the owned session and confirm its cleanup before reviewing another")
	}
	plan, err := s.prepare(ctx, request)
	if err != nil {
		return Preview{}, err
	}
	id, err := randomID()
	if err != nil {
		return Preview{}, err
	}
	value := Preview{Revision: id, ExpiresAt: time.Now().UTC().Add(time.Minute), Request: plan.request, Audience: plan.audience, Executable: plan.path, Arguments: append([]string{}, plan.args...), Origin: plan.origin, Notice: "Only this foreground process is owned. Stop, the selected duration, or closing ProtoPeek ends it. A connected origin is TCP evidence; the published endpoint is not verified."}
	if request.Mode == "quick" {
		value.Notice += " Anyone with the temporary URL can access the service. Quick Tunnels have no uptime guarantee and are intended for testing. The private empty config path is allocated only when starting."
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.starting || blocksNew(s.current) {
		return Preview{}, publicError("session state changed; review again")
	}
	s.preview = &issuedPreview{value, plan}
	return value, nil
}

func (s *Supervisor) Start(ctx context.Context, request StartRequest) (Session, error) {
	s.mu.Lock()
	if s.closed || s.starting || blocksNew(s.current) || !request.Confirmed || s.preview == nil || s.preview.value.Revision != request.Revision || time.Now().After(s.preview.value.ExpiresAt) {
		s.mu.Unlock()
		return Session{}, publicError("review and explicitly confirm a current publishing preview first")
	}
	preview := s.preview
	s.preview = nil // one-use consent, including failed preflights
	s.starting = true
	s.mu.Unlock()
	defer func() { s.mu.Lock(); s.starting = false; s.mu.Unlock() }()
	plan, err := s.prepare(ctx, preview.prepared.request)
	if err != nil {
		return Session{}, err
	}
	if plan.fingerprint != preview.prepared.fingerprint {
		return Session{}, publicError("native state or origin changed; review the destination and audience again")
	}
	if !plan.origin.Connected {
		return Session{}, publicError("the loopback origin did not accept a TCP connection; start that service and review again")
	}
	id, err := randomID()
	if err != nil {
		return Session{}, err
	}
	duration := time.Duration(plan.request.Minutes) * time.Minute
	if s.lifetimeLimit > 0 && duration > s.lifetimeLimit {
		duration = s.lifetimeLimit
	}
	lifetime, cancel := context.WithTimeout(s.ctx, duration)
	value := &owned{Session: Session{ID: id, Mode: plan.request.Mode, Audience: plan.audience, OriginURL: plan.request.Origin, Origin: plan.origin, State: "starting", Cleanup: "pending", StartedAt: time.Now().UTC(), ExpiresAt: time.Now().UTC().Add(duration), Events: []Event{}}, prepared: plan, cancel: cancel, scope: lifetime, done: make(chan struct{}), ready: make(chan struct{})}
	args := append([]string{}, plan.args...)
	if plan.request.Mode == "quick" {
		value.directory, err = os.MkdirTemp("", "protopeek-quick-")
		if err == nil {
			value.config = value.directory + string(os.PathSeparator) + "empty.yml"
			err = os.WriteFile(value.config, []byte("{}\n"), 0600)
		}
		if err != nil {
			cancel()
			removeConfig(value)
			return Session{}, publicError("unable to create a private temporary tunnel configuration")
		}
		args[2] = value.config
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		cancel()
		removeConfig(value)
		return Session{}, publicError("ProtoPeek is shutting down")
	}
	s.current = value
	s.event(value, "Starting the reviewed foreground process. Raw native output is not retained.")
	s.mu.Unlock()
	process, err := s.start(lifetime, plan.path, args, writer{s, value})
	if err != nil {
		cancel()
		removeConfig(value)
		s.mu.Lock()
		value.State = "failed"
		value.Reason = "The native executable could not start. Check installation and permissions."
		value.Cleanup = "confirmed"
		close(value.done)
		s.mu.Unlock()
		return s.session(value), nil
	}
	s.mu.Lock()
	value.child = process
	value.PID = process.PID()
	s.mu.Unlock()
	// From acceptance onward the process belongs to the supervisor lifetime,
	// independently of the HTTP request or the browser page that started it.
	go s.wait(value, lifetime)
	go s.watchStartup(value)
	return s.session(value), nil
}
func removeConfig(value *owned) {
	if value.config != "" {
		_ = os.Remove(value.config)
	}
	if value.directory != "" {
		_ = os.Remove(value.directory)
	}
}
func (s *Supervisor) event(value *owned, message string) {
	value.Events = append(value.Events, Event{time.Now().UTC(), message})
	if len(value.Events) > 64 {
		value.Events = value.Events[len(value.Events)-64:]
	}
}
func (s *Supervisor) session(value *owned) Session {
	s.mu.Lock()
	defer s.mu.Unlock()
	copy := value.Session
	copy.Events = append([]Event{}, value.Events...)
	return copy
}
func (s *Supervisor) Inspect(parent context.Context) (Snapshot, error) {
	s.mu.Lock()
	value := s.current
	recheck := value != nil && !active(value.State) && value.Cleanup == "unconfirmed" && value.Mode != "quick" && !value.processUnconfirmed
	s.mu.Unlock()
	if recheck {
		ctx, done := context.WithTimeout(parent, 3*time.Second)
		raw, err := s.run(ctx, value.prepared.path, "serve", "status", "--json")
		done()
		if err == nil && emptyConfig(raw) {
			s.mu.Lock()
			if s.current == value && value.Cleanup == "unconfirmed" {
				value.Cleanup = "confirmed"
				value.Reason = "The owned process ended. Native Serve configuration is now observed empty."
				s.event(value, value.Reason)
			}
			s.mu.Unlock()
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil {
		return Snapshot{}, nil
	}
	copy := s.current.Session
	copy.Events = append([]Event{}, copy.Events...)
	return Snapshot{Session: &copy}, nil
}

// Verify is an explicit HEAD against the endpoint reported by the owned client.
// It does not follow redirects or transfer response bodies, cookies or auth.
func (s *Supervisor) Verify(parent context.Context, id string) (Session, error) {
	s.mu.Lock()
	value := s.current
	if value == nil || value.ID != id || value.State != "running" || value.Endpoint == "" {
		s.mu.Unlock()
		return Session{}, publicError("choose a running owned session with a reported endpoint")
	}
	endpoint := value.Endpoint
	s.mu.Unlock()
	ctx, cancel := context.WithTimeout(parent, 3*time.Second)
	defer cancel()
	stop := context.AfterFunc(value.scope, cancel)
	defer stop()
	status, err := s.verify(ctx, endpoint)
	s.mu.Lock()
	if s.current != value || value.State != "running" {
		s.mu.Unlock()
		return Session{}, publicError("the owned session ended during the endpoint check")
	}
	now := time.Now().UTC()
	value.EndpointCheckedAt = &now
	value.EndpointStatus = status
	value.EndpointVerified = err == nil
	value.EndpointError = ""
	if err != nil {
		value.EndpointError = "No verified HTTPS response was observed within the check bounds. The native process may still be running."
	}
	s.event(value, "Explicit endpoint HTTPS check completed. HTTP status is separate from application behavior.")
	s.mu.Unlock()
	return s.session(value), nil
}
func (s *Supervisor) watchStartup(value *owned) {
	timer := time.NewTimer(s.startupLimit)
	defer timer.Stop()
	select {
	case <-value.ready:
	case <-value.done:
	case <-timer.C:
		s.mu.Lock()
		if value.State == "starting" {
			value.State = "failed"
			value.Reason = "The native process did not report a ready endpoint within 15 seconds."
			s.event(value, value.Reason)
			value.cancel()
		}
		s.mu.Unlock()
	}
}
func (s *Supervisor) wait(value *owned, ctx context.Context) {
	err := value.child.Wait()
	contextErr := ctx.Err()
	value.cancel()
	removeConfig(value)
	cleanup := "confirmed"
	processUnconfirmed := errors.Is(err, errProcessOwnershipUnconfirmed)
	if processUnconfirmed {
		cleanup = "unconfirmed"
	}
	if value.Mode != "quick" {
		observe, done := context.WithTimeout(context.Background(), 3*time.Second)
		raw, observeErr := s.run(observe, value.prepared.path, "serve", "status", "--json")
		done()
		if observeErr != nil || !emptyConfig(raw) {
			cleanup = "unconfirmed"
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	value.Cleanup = cleanup
	value.processUnconfirmed = processUnconfirmed
	if value.State != "failed" {
		switch {
		case value.State == "stopping":
			value.State = "stopped"
		case contextErr != nil:
			value.State = "stopped"
			value.Reason = "The session duration ended or ProtoPeek shut down."
		case err != nil:
			value.State = "failed"
			value.Reason = "The native process exited with an error. Inspect its native setup before starting again."
		case value.State == "starting":
			value.State = "failed"
			value.Reason = "The native process exited before reporting an endpoint."
		default:
			value.State = "stopped"
			value.Reason = "The native foreground process ended."
		}
	}
	if processUnconfirmed {
		value.Reason += " Native process-group cleanup could not be confirmed. Confirm no native client process or public exposure remains, then restart ProtoPeek before sharing again."
	} else if cleanup == "unconfirmed" {
		value.Reason += " Cleanup could not be confirmed from native Serve status; existing rules were preserved. Inspect the installed client."
	}
	s.event(value, value.Reason)
	close(value.done)
}
func (s *Supervisor) Stop(ctx context.Context, id string) (Session, error) {
	if len(id) != 32 {
		return Session{}, publicError("choose the owned session identity")
	}
	s.mu.Lock()
	value := s.current
	if value == nil || value.ID != id {
		s.mu.Unlock()
		return Session{}, publicError("this session is not owned by this ProtoPeek process")
	}
	if active(value.State) {
		value.State = "stopping"
		value.Reason = "Stopped by user."
		value.cancel()
	}
	process := value.child
	s.mu.Unlock()
	if process != nil {
		_ = process.Kill()
	}
	limit, done := context.WithTimeout(ctx, 4*time.Second)
	defer done()
	select {
	case <-value.done:
		return s.session(value), nil
	case <-limit.Done():
		return s.session(value), publicError("owned process shutdown is not yet confirmed; refresh this session")
	}
}
func (s *Supervisor) Close() error {
	s.mu.Lock()
	s.closed = true
	s.preview = nil
	value := s.current
	s.cancel()
	s.mu.Unlock()
	if value == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	result, err := s.Stop(ctx, value.ID)
	if err == nil && result.Cleanup != "confirmed" {
		err = publicError("native publishing cleanup was not confirmed")
	}
	return err
}

type writer struct {
	supervisor *Supervisor
	value      *owned
}

func (w writer) Write(data []byte) (int, error) {
	s, value := w.supervisor, w.value
	s.mu.Lock()
	defer s.mu.Unlock()
	value.bytes += len(data)
	if value.bytes > 256<<10 {
		value.State = "failed"
		value.Reason = "Native output exceeded the 256 KiB session limit."
		value.cancel()
		return 0, errors.New("session output limit")
	}
	for _, part := range data {
		if part == '\n' {
			s.line(value, string(value.pending))
			value.pending = value.pending[:0]
		} else {
			if len(value.pending) >= 4096 {
				value.State = "failed"
				value.Reason = "Native output exceeded the 4 KiB line limit."
				value.cancel()
				return 0, errors.New("session line limit")
			}
			value.pending = append(value.pending, part)
		}
	}
	return len(data), nil
}
func (s *Supervisor) line(value *owned, line string) {
	if value.Mode == "quick" && strings.Contains(line, "Registered tunnel connection") {
		value.registered = true
	}
	endpoint := reportedEndpoint(line, value.prepared.endpoint, value.Mode)
	if endpoint != "" {
		value.Endpoint = endpoint
	}
	if value.State == "starting" && value.Endpoint != "" && (value.Mode != "quick" || value.registered) {
		value.State = "running"
		s.event(value, "The native client reported the endpoint. End-to-end reachability has not been checked.")
		value.readyOnce.Do(func() { close(value.ready) })
	}
}
