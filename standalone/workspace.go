package standalone

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/fullstorydev/grpcurl"
	"github.com/jhump/protoreflect/desc"
	"github.com/jhump/protoreflect/grpcreflect"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	insecurecreds "google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/grpc/metadata"
)

const defaultWorkspaceSchemaSource = "reflection"

type WorkspaceTargetConfig struct {
	Address      string   `json:"address"`
	Plaintext    bool     `json:"plaintext"`
	Insecure     bool     `json:"insecure"`
	Authority    string   `json:"authority"`
	CACertPath   string   `json:"cacertPath"`
	CertPath     string   `json:"certPath"`
	KeyPath      string   `json:"keyPath"`
	SchemaSource string   `json:"schemaSource"`
	ProtoFiles   []string `json:"protoFiles"`
	ImportPaths  []string `json:"importPaths"`
	Protosets    []string `json:"protosets"`
}

type WorkspaceManagerOptions struct {
	Version           string
	BasePath          string
	DefaultHeaders    []string
	ReflectionHeaders []string
	ConnectTimeout    time.Duration
	ConnectFailFast   bool
	KeepaliveTime     time.Duration
	MaxMsgSize        int
	MaxSessions       int
	TargetDefaults    WorkspaceTargetConfig
}

type WorkspaceConnectResponse struct {
	SessionID string `json:"sessionId"`
	Bootstrap any    `json:"bootstrap"`
}

type WorkspaceManager struct {
	mu                     sync.RWMutex
	sessions               map[string]*workspaceSession
	activeUploads          map[uint64]context.CancelFunc
	nextUploadID           uint64
	uploadDescriptorLoader workspaceUploadDescriptorLoader
	dialTargetOverride     func(context.Context, WorkspaceTargetConfig) (*grpc.ClientConn, error)
	closed                 bool
	opts                   WorkspaceManagerOptions
}

type workspaceSession struct {
	id               string
	target           WorkspaceTargetConfig
	cc               *grpc.ClientConn
	methods          []*desc.MethodDescriptor
	files            []*desc.FileDescriptor
	descSource       grpcurl.DescriptorSource
	bootstrapJSON    []byte
	protoCatalogJSON []byte
	createdAt        time.Time
}

func NewWorkspaceManager(opts WorkspaceManagerOptions) *WorkspaceManager {
	normalizedDefaults := opts.TargetDefaults.normalized()
	if opts.ConnectTimeout <= 0 {
		opts.ConnectTimeout = 10 * time.Second
	}
	if opts.MaxSessions <= 0 {
		opts.MaxSessions = 12
	}
	opts.TargetDefaults = normalizedDefaults
	return &WorkspaceManager{
		sessions:               map[string]*workspaceSession{},
		activeUploads:          map[uint64]context.CancelFunc{},
		uploadDescriptorLoader: loadUploadedWorkspaceDescriptors,
		opts:                   opts,
	}
}

func (m *WorkspaceManager) Connect(ctx context.Context, cfg WorkspaceTargetConfig) (*workspaceSession, error) {
	normalized := cfg.normalized()
	if err := normalized.validate(); err != nil {
		return nil, err
	}

	if ctx == nil {
		ctx = context.Background()
	}
	dialCtx := ctx
	var cancel context.CancelFunc
	if m.opts.ConnectTimeout > 0 {
		dialCtx, cancel = context.WithTimeout(ctx, m.opts.ConnectTimeout)
	}

	cc, err := m.dialTarget(dialCtx, normalized)
	if cancel != nil {
		cancel()
	}
	if err != nil {
		return nil, err
	}

	methods, files, descSource, err := loadWorkspaceDescriptors(ctx, cc, normalized, m.opts.ReflectionHeaders)
	if err != nil {
		_ = cc.Close()
		return nil, err
	}
	return m.publishSession(ctx, normalized, cc, methods, files, descSource)
}

func (m *WorkspaceManager) publishSession(ctx context.Context, normalized WorkspaceTargetConfig, cc *grpc.ClientConn, methods []*desc.MethodDescriptor, files []*desc.FileDescriptor, descSource grpcurl.DescriptorSource) (*workspaceSession, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		_ = cc.Close()
		return nil, err
	}
	protoCatalogJSON, err := buildProtoCatalog(files)
	if err != nil {
		_ = cc.Close()
		return nil, err
	}

	id, err := randomSessionID()
	if err != nil {
		_ = cc.Close()
		return nil, err
	}

	bootstrapJSON, err := buildBootstrap(normalized.Address, methods, &handlerOptions{
		version:         m.opts.Version,
		basePath:        m.opts.BasePath,
		defaultMetadata: m.opts.DefaultHeaders,
		gRPCurlOptions:  workspaceGRPCOptions(normalized),
		launcherMode:    true,
		targetDefaults:  m.opts.TargetDefaults,
	})
	if err != nil {
		_ = cc.Close()
		return nil, err
	}

	session := &workspaceSession{
		id:               id,
		target:           normalized,
		cc:               cc,
		methods:          methods,
		files:            files,
		descSource:       descSource,
		bootstrapJSON:    bootstrapJSON,
		protoCatalogJSON: protoCatalogJSON,
		createdAt:        time.Now(),
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if err := ctx.Err(); err != nil {
		_ = cc.Close()
		return nil, err
	}
	if m.closed {
		_ = cc.Close()
		return nil, fmt.Errorf("workspace manager is closed")
	}
	if len(m.sessions) >= m.opts.MaxSessions {
		oldestID := ""
		var oldest time.Time
		for id, existing := range m.sessions {
			if oldestID == "" || existing.createdAt.Before(oldest) {
				oldestID = id
				oldest = existing.createdAt
			}
		}
		if oldestID != "" {
			if m.sessions[oldestID].cc != nil {
				_ = m.sessions[oldestID].cc.Close()
			}
			delete(m.sessions, oldestID)
		}
	}
	m.sessions[id] = session
	return session, nil
}

func (m *WorkspaceManager) Session(id string) (*workspaceSession, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	session, ok := m.sessions[id]
	return session, ok
}

func (m *WorkspaceManager) Disconnect(id string) bool {
	m.mu.Lock()
	session, ok := m.sessions[id]
	if ok {
		delete(m.sessions, id)
	}
	m.mu.Unlock()
	if !ok {
		return false
	}
	if session.cc != nil {
		_ = session.cc.Close()
	}
	return true
}

func (m *WorkspaceManager) sessionFromRequest(r *http.Request) *workspaceSession {
	sessionID := strings.TrimSpace(r.URL.Query().Get("session_id"))
	if sessionID == "" {
		return nil
	}
	session, ok := m.Session(sessionID)
	if !ok {
		return nil
	}
	return session
}

func (m *WorkspaceManager) Close() error {
	m.mu.Lock()
	firstClose := !m.closed
	m.closed = true
	sessions := make([]*workspaceSession, 0, len(m.sessions))
	if firstClose {
		for id, session := range m.sessions {
			sessions = append(sessions, session)
			delete(m.sessions, id)
		}
	}
	uploadCancels := make([]context.CancelFunc, 0, len(m.activeUploads))
	for id, cancel := range m.activeUploads {
		uploadCancels = append(uploadCancels, cancel)
		delete(m.activeUploads, id)
	}
	m.mu.Unlock()

	var firstErr error
	for _, cancel := range uploadCancels {
		cancel()
	}
	for _, session := range sessions {
		if session.cc == nil {
			continue
		}
		if err := session.cc.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

func (m *WorkspaceManager) dialTarget(ctx context.Context, cfg WorkspaceTargetConfig) (*grpc.ClientConn, error) {
	if m.dialTargetOverride != nil {
		return m.dialTargetOverride(ctx, cfg)
	}
	var opts []grpc.DialOption
	if m.opts.KeepaliveTime > 0 {
		opts = append(opts, grpc.WithKeepaliveParams(keepalive.ClientParameters{
			Time:    m.opts.KeepaliveTime,
			Timeout: m.opts.KeepaliveTime,
		}))
	}
	if m.opts.MaxMsgSize > 0 {
		opts = append(opts, grpc.WithDefaultCallOptions(grpc.MaxCallRecvMsgSize(m.opts.MaxMsgSize)))
	}

	var creds credentials.TransportCredentials
	if cfg.Plaintext {
		if cfg.Authority != "" {
			opts = append(opts, grpc.WithAuthority(cfg.Authority))
		}
	} else {
		tlsConf, err := grpcurl.ClientTLSConfig(cfg.Insecure, cfg.CACertPath, cfg.CertPath, cfg.KeyPath)
		if err != nil {
			return nil, fmt.Errorf("failed to create TLS config: %w", err)
		}
		if tlsConf == nil {
			tlsConf = &tls.Config{}
		}
		if cfg.Authority != "" {
			tlsConf.ServerName = cfg.Authority
			opts = append(opts, grpc.WithAuthority(cfg.Authority))
		}
		creds = credentials.NewTLS(tlsConf)
	}

	return workspaceDial(ctx, "tcp", cfg.Address, creds, m.opts.ConnectFailFast, opts...)
}

func (cfg WorkspaceTargetConfig) normalized() WorkspaceTargetConfig {
	normalized := cfg
	normalized.Address = strings.TrimSpace(normalized.Address)
	normalized.Authority = strings.TrimSpace(normalized.Authority)
	normalized.CACertPath = strings.TrimSpace(normalized.CACertPath)
	normalized.CertPath = strings.TrimSpace(normalized.CertPath)
	normalized.KeyPath = strings.TrimSpace(normalized.KeyPath)
	if normalized.SchemaSource == "" {
		normalized.SchemaSource = defaultWorkspaceSchemaSource
	}
	normalized.ProtoFiles = trimStringSlice(normalized.ProtoFiles)
	normalized.ImportPaths = trimStringSlice(normalized.ImportPaths)
	normalized.Protosets = trimStringSlice(normalized.Protosets)
	return normalized
}

func (cfg WorkspaceTargetConfig) validate() error {
	if err := cfg.validateConnection(); err != nil {
		return err
	}

	switch cfg.SchemaSource {
	case "reflection":
	case "proto-files":
		if len(cfg.ProtoFiles) == 0 {
			return fmt.Errorf("at least one proto file is required when schema source is proto-files")
		}
	case "protoset":
		if len(cfg.Protosets) == 0 {
			return fmt.Errorf("at least one protoset file is required when schema source is protoset")
		}
	case "browser-proto-folder":
		return fmt.Errorf("browser-proto-folder schema requires a multipart upload")
	default:
		return fmt.Errorf("unsupported schema source %q", cfg.SchemaSource)
	}
	return nil
}

func (cfg WorkspaceTargetConfig) validateConnection() error {
	if cfg.Address == "" {
		return fmt.Errorf("target address is required")
	}
	if cfg.Plaintext && cfg.Insecure {
		return fmt.Errorf("plaintext and insecure cannot both be enabled")
	}
	if cfg.Plaintext && (cfg.CACertPath != "" || cfg.CertPath != "" || cfg.KeyPath != "") {
		return fmt.Errorf("TLS certificate paths cannot be used with plaintext targets")
	}
	if (cfg.CertPath == "") != (cfg.KeyPath == "") {
		return fmt.Errorf("client certificate and key must be provided together")
	}
	return nil
}

func workspaceGRPCOptions(cfg WorkspaceTargetConfig) []string {
	options := make([]string, 0, 8+len(cfg.ProtoFiles)+len(cfg.ImportPaths)+len(cfg.Protosets))
	if cfg.Plaintext {
		options = append(options, "-plaintext")
	}
	if cfg.Insecure {
		options = append(options, "-insecure")
	}
	if cfg.Authority != "" {
		options = append(options, fmt.Sprintf("-authority=%q", cfg.Authority))
	}
	if cfg.CACertPath != "" {
		options = append(options, fmt.Sprintf("-cacert=%q", cfg.CACertPath))
	}
	if cfg.CertPath != "" {
		options = append(options, fmt.Sprintf("-cert=%q", cfg.CertPath))
	}
	if cfg.KeyPath != "" {
		options = append(options, fmt.Sprintf("-key=%q", cfg.KeyPath))
	}
	for _, importPath := range cfg.ImportPaths {
		options = append(options, fmt.Sprintf("-import-path=%q", importPath))
	}
	for _, protoFile := range cfg.ProtoFiles {
		options = append(options, fmt.Sprintf("-proto=%q", protoFile))
	}
	for _, protoset := range cfg.Protosets {
		options = append(options, fmt.Sprintf("-protoset=%q", protoset))
	}
	sort.Strings(options)
	return options
}

func loadWorkspaceDescriptors(ctx context.Context, cc *grpc.ClientConn, cfg WorkspaceTargetConfig, reflectionHeaders []string) ([]*desc.MethodDescriptor, []*desc.FileDescriptor, grpcurl.DescriptorSource, error) {
	switch cfg.SchemaSource {
	case "reflection":
		reflectionContext := metadata.NewOutgoingContext(ctx, grpcurl.MetadataFromHeaders(reflectionHeaders))
		reflectionClient := grpcreflect.NewClientAuto(reflectionContext, cc)
		defer reflectionClient.Reset()
		reflectionClient.AllowMissingFileDescriptors()
		source := grpcurl.DescriptorSourceFromServer(ctx, reflectionClient)
		methods, err := allMethodsFromDescriptorSource(source)
		if err != nil {
			return nil, nil, nil, err
		}
		files, err := grpcurl.GetAllFiles(source)
		if err != nil {
			return nil, nil, nil, err
		}
		fileSource, err := grpcurl.DescriptorSourceFromFileDescriptors(files...)
		if err != nil {
			return nil, nil, nil, err
		}
		return methods, files, fileSource, nil
	case "proto-files":
		source, err := grpcurl.DescriptorSourceFromProtoFiles(cfg.ImportPaths, cfg.ProtoFiles...)
		if err != nil {
			return nil, nil, nil, err
		}
		methods, err := allMethodsFromDescriptorSource(source)
		if err != nil {
			return nil, nil, nil, err
		}
		files, err := grpcurl.GetAllFiles(source)
		if err != nil {
			return nil, nil, nil, err
		}
		return methods, files, source, nil
	case "protoset":
		source, err := grpcurl.DescriptorSourceFromProtoSets(cfg.Protosets...)
		if err != nil {
			return nil, nil, nil, err
		}
		methods, err := allMethodsFromDescriptorSource(source)
		if err != nil {
			return nil, nil, nil, err
		}
		files, err := grpcurl.GetAllFiles(source)
		if err != nil {
			return nil, nil, nil, err
		}
		return methods, files, source, nil
	default:
		return nil, nil, nil, fmt.Errorf("unsupported schema source %q", cfg.SchemaSource)
	}
}

func allMethodsFromDescriptorSource(source grpcurl.DescriptorSource) ([]*desc.MethodDescriptor, error) {
	services, err := source.ListServices()
	if err != nil {
		return nil, err
	}
	methods := make([]*desc.MethodDescriptor, 0)
	for _, svc := range services {
		if svc == "grpc.reflection.v1alpha.ServerReflection" || svc == "grpc.reflection.v1.ServerReflection" {
			continue
		}
		descriptor, err := source.FindSymbol(svc)
		if err != nil {
			return nil, err
		}
		service, ok := descriptor.(*desc.ServiceDescriptor)
		if !ok {
			return nil, fmt.Errorf("%s resolved to %T instead of a service descriptor", svc, descriptor)
		}
		methods = append(methods, service.GetMethods()...)
	}
	return methods, nil
}

func randomSessionID() (string, error) {
	var raw [12]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw[:]), nil
}

func trimStringSlice(values []string) []string {
	trimmed := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		trimmed = append(trimmed, value)
	}
	return trimmed
}

func workspaceDial(ctx context.Context, network, addr string, creds credentials.TransportCredentials, failFast bool, opts ...grpc.DialOption) (*grpc.ClientConn, error) {
	if failFast {
		return grpcurl.BlockingDial(ctx, network, addr, creds, opts...)
	}

	dialer := &workspaceErrTrackingDialer{
		dialer:  &net.Dialer{},
		network: network,
	}
	var errCreds workspaceErrTrackingCreds
	if creds == nil {
		opts = append(opts, grpc.WithTransportCredentials(insecurecreds.NewCredentials()))
	} else {
		errCreds = workspaceErrTrackingCreds{TransportCredentials: creds}
		opts = append(opts, grpc.WithTransportCredentials(&errCreds))
	}

	cc, err := grpc.DialContext(ctx, addr, append(opts, grpc.WithBlock(), grpc.WithContextDialer(dialer.dial))...)
	if err == nil {
		return cc, nil
	}
	if err := errCreds.err(); err != nil {
		return nil, err
	}
	if err := dialer.err(); err != nil {
		return nil, err
	}
	return nil, err
}

type workspaceErrTrackingCreds struct {
	credentials.TransportCredentials

	mu      sync.Mutex
	lastErr error
}

func (c *workspaceErrTrackingCreds) ClientHandshake(ctx context.Context, addr string, rawConn net.Conn) (net.Conn, credentials.AuthInfo, error) {
	conn, auth, err := c.TransportCredentials.ClientHandshake(ctx, addr, rawConn)
	if err != nil {
		c.mu.Lock()
		c.lastErr = err
		c.mu.Unlock()
	}
	return conn, auth, err
}

func (c *workspaceErrTrackingCreds) err() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.lastErr
}

type workspaceErrTrackingDialer struct {
	dialer  *net.Dialer
	network string

	mu      sync.Mutex
	lastErr error
}

func (d *workspaceErrTrackingDialer) dial(ctx context.Context, addr string) (net.Conn, error) {
	conn, err := d.dialer.DialContext(ctx, d.network, addr)
	if err != nil {
		d.mu.Lock()
		d.lastErr = err
		d.mu.Unlock()
	}
	return conn, err
}

func (d *workspaceErrTrackingDialer) err() error {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.lastErr
}
