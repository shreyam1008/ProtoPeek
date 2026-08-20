package standalone

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path"
	"strings"
	"sync"
	"unicode"
	"unicode/utf8"

	"github.com/fullstorydev/grpcurl"
	"github.com/jhump/protoreflect/desc"
	"github.com/jhump/protoreflect/desc/protoparse"
)

const (
	maxWorkspaceUploadBodyBytes      int64 = 20 << 20
	maxWorkspaceUploadAggregateBytes int64 = 16 << 20
	maxWorkspaceUploadFileBytes      int64 = 4 << 20
	maxWorkspaceUploadFiles                = 512
	maxWorkspaceUploadPathBytes            = 512
	maxWorkspaceUploadComponentBytes       = 255
	maxWorkspaceUploadPathDepth            = 32
	maxWorkspaceUploadTargetBytes    int64 = 64 << 10
	maxWorkspaceUploadManifestBytes  int64 = 512 << 10
	maxWorkspaceConcurrentUploads          = 2
)

type workspaceUploadManifest struct {
	Version int                           `json:"version"`
	Files   []workspaceUploadManifestFile `json:"files"`
}

type workspaceUploadManifestFile struct {
	Path string `json:"path"`
	Size int64  `json:"size"`
}

type workspaceUploadDescriptorLoader func(map[string][]byte, []string) ([]*desc.MethodDescriptor, []*desc.FileDescriptor, grpcurl.DescriptorSource, error)

type workspaceUploadLimitError struct {
	message string
}

type workspaceUploadBusyError struct{}

func (*workspaceUploadBusyError) Error() string {
	return "proto upload capacity is busy; retry shortly"
}

func (e *workspaceUploadLimitError) Error() string {
	return e.message
}

func workspaceUploadLimit(message string) error {
	return &workspaceUploadLimitError{message: message}
}

func (m *WorkspaceManager) connectUploadedProtoFolder(ctx context.Context, reader *multipart.Reader) (*workspaceSession, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	requestContext := ctx
	uploadContext, releaseUpload, err := m.beginWorkspaceUpload(ctx)
	if err != nil {
		return nil, err
	}
	ctx = uploadContext
	released := false
	defer func() {
		if !released {
			releaseUpload()
		}
	}()

	targetPart, err := nextWorkspaceUploadPart(reader, "target")
	if err != nil {
		return nil, err
	}
	if targetPart.FileName() != "" {
		return nil, fmt.Errorf("multipart target part must be a JSON field")
	}
	var target WorkspaceTargetConfig
	if err := decodeWorkspaceUploadJSON(targetPart, maxWorkspaceUploadTargetBytes, false, &target); err != nil {
		return nil, fmt.Errorf("invalid multipart target: %w", err)
	}
	target = target.normalized()
	if err := target.validateBrowserProtoFolder(); err != nil {
		return nil, err
	}

	manifestPart, err := nextWorkspaceUploadPart(reader, "manifest")
	if err != nil {
		return nil, err
	}
	if manifestPart.FileName() != "" {
		return nil, fmt.Errorf("multipart manifest part must be a JSON field")
	}
	var manifest workspaceUploadManifest
	if err := decodeWorkspaceUploadJSON(manifestPart, maxWorkspaceUploadManifestBytes, true, &manifest); err != nil {
		return nil, fmt.Errorf("invalid multipart manifest: %w", err)
	}
	if err := validateWorkspaceUploadManifest(manifest); err != nil {
		return nil, err
	}

	paths := make([]string, 0, len(manifest.Files))
	contents := make(map[string][]byte, len(manifest.Files))
	defer clearWorkspaceUploadContents(contents)
	for index, file := range manifest.Files {
		part, err := nextWorkspaceUploadPart(reader, fmt.Sprintf("file.%d", index))
		if err != nil {
			return nil, err
		}
		if part.FileName() == "" {
			_ = part.Close()
			return nil, fmt.Errorf("multipart part %q must be a file", part.FormName())
		}
		fileContents, err := readWorkspaceUploadFile(ctx, part, file)
		if err != nil {
			return nil, err
		}
		paths = append(paths, file.Path)
		contents[file.Path] = fileContents
	}
	if extra, err := reader.NextPart(); err != io.EOF {
		if err != nil {
			return nil, fmt.Errorf("read multipart upload: %w", err)
		}
		_ = extra.Close()
		return nil, fmt.Errorf("unexpected multipart part %q", extra.FormName())
	}

	methods, files, source, err := m.uploadDescriptorLoader(contents, paths)
	uploadContextErr := ctx.Err()
	clearWorkspaceUploadContents(contents)
	contents = nil
	if err != nil {
		return nil, sanitizeWorkspaceUploadError(err)
	}
	if uploadContextErr != nil {
		return nil, uploadContextErr
	}
	if err := validateWorkspaceSchemaResources(ctx, methods, files, m.schemaLimits); err != nil {
		return nil, err
	}
	releaseUpload()
	released = true

	dialCtx := requestContext
	var cancel context.CancelFunc
	if m.opts.ConnectTimeout > 0 {
		dialCtx, cancel = context.WithTimeout(requestContext, m.opts.ConnectTimeout)
	}
	cc, err := m.dialTarget(dialCtx, target)
	if cancel != nil {
		cancel()
	}
	if err != nil {
		return nil, err
	}
	return m.publishSession(requestContext, target, cc, methods, files, source)
}

func (m *WorkspaceManager) beginWorkspaceUpload(parent context.Context) (context.Context, func(), error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return nil, nil, fmt.Errorf("workspace manager is closed")
	}
	if len(m.activeUploads) >= maxWorkspaceConcurrentUploads {
		return nil, nil, &workspaceUploadBusyError{}
	}

	ctx, cancel := context.WithCancel(parent)
	m.nextUploadID++
	id := m.nextUploadID
	m.activeUploads[id] = cancel
	var once sync.Once
	return ctx, func() {
		once.Do(func() {
			cancel()
			m.mu.Lock()
			delete(m.activeUploads, id)
			m.mu.Unlock()
		})
	}, nil
}

func (cfg WorkspaceTargetConfig) validateBrowserProtoFolder() error {
	if err := cfg.validateConnection(); err != nil {
		return err
	}
	if cfg.SchemaSource != "browser-proto-folder" {
		return fmt.Errorf("multipart proto upload requires schema source browser-proto-folder")
	}
	if len(cfg.ProtoFiles) != 0 || len(cfg.ImportPaths) != 0 || len(cfg.Protosets) != 0 {
		return fmt.Errorf("browser proto folder cannot include host proto or protoset paths")
	}
	return nil
}

func nextWorkspaceUploadPart(reader *multipart.Reader, expectedName string) (*multipart.Part, error) {
	part, err := reader.NextPart()
	if err == io.EOF {
		return nil, fmt.Errorf("multipart upload is missing %q", expectedName)
	}
	if err != nil {
		return nil, fmt.Errorf("read multipart upload: %w", err)
	}
	if part.FormName() != expectedName {
		_ = part.Close()
		return nil, fmt.Errorf("multipart part %q is out of order; expected %q", part.FormName(), expectedName)
	}
	return part, nil
}

func decodeWorkspaceUploadJSON(part *multipart.Part, limit int64, disallowUnknown bool, destination any) error {
	defer func() { _ = part.Close() }()
	contents, err := io.ReadAll(io.LimitReader(part, limit+1))
	if err != nil {
		return err
	}
	if int64(len(contents)) > limit {
		return workspaceUploadLimit("multipart JSON part is too large")
	}
	if !utf8.Valid(contents) {
		return fmt.Errorf("JSON must be valid UTF-8")
	}
	decoder := json.NewDecoder(bytes.NewReader(contents))
	if disallowUnknown {
		decoder.DisallowUnknownFields()
	}
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return fmt.Errorf("JSON part must contain one object")
	}
	return nil
}

func validateWorkspaceUploadManifest(manifest workspaceUploadManifest) error {
	if manifest.Version != 1 {
		return fmt.Errorf("unsupported proto upload manifest version %d", manifest.Version)
	}
	if len(manifest.Files) == 0 {
		return fmt.Errorf("proto upload manifest must contain at least one file")
	}
	if len(manifest.Files) > maxWorkspaceUploadFiles {
		return workspaceUploadLimit(fmt.Sprintf("proto upload exceeds the %d file limit", maxWorkspaceUploadFiles))
	}

	var total int64
	seen := make([]string, 0, len(manifest.Files))
	for _, file := range manifest.Files {
		if err := validateWorkspaceUploadPath(file.Path); err != nil {
			return err
		}
		for _, existing := range seen {
			if strings.EqualFold(existing, file.Path) {
				return fmt.Errorf("proto upload path %q duplicates %q", file.Path, existing)
			}
		}
		seen = append(seen, file.Path)
		if file.Size < 0 {
			return fmt.Errorf("proto upload file %q has a negative size", file.Path)
		}
		if file.Size > maxWorkspaceUploadFileBytes {
			return workspaceUploadLimit(fmt.Sprintf("proto upload file %q exceeds the %d byte limit", file.Path, maxWorkspaceUploadFileBytes))
		}
		if file.Size > maxWorkspaceUploadAggregateBytes-total {
			return workspaceUploadLimit(fmt.Sprintf("proto upload exceeds the %d byte aggregate limit", maxWorkspaceUploadAggregateBytes))
		}
		total += file.Size
	}
	return nil
}

func validateWorkspaceUploadPath(value string) error {
	if value == "" {
		return fmt.Errorf("proto upload path must not be empty")
	}
	if !utf8.ValidString(value) {
		return fmt.Errorf("proto upload path must be valid UTF-8")
	}
	if len(value) > maxWorkspaceUploadPathBytes {
		return fmt.Errorf("proto upload path exceeds the %d byte limit", maxWorkspaceUploadPathBytes)
	}
	if strings.ContainsRune(value, 0) || strings.ContainsAny(value, `\\:<>"|?*`) {
		return fmt.Errorf("proto upload path %q is not a portable relative path", value)
	}
	if path.IsAbs(value) || strings.HasPrefix(value, "/") || path.Clean(value) != value {
		return fmt.Errorf("proto upload path %q is not a canonical relative path", value)
	}
	if path.Ext(value) != ".proto" {
		return fmt.Errorf("proto upload path %q must use the lowercase .proto suffix", value)
	}

	components := strings.Split(value, "/")
	if len(components) > maxWorkspaceUploadPathDepth {
		return fmt.Errorf("proto upload path %q exceeds the depth limit of %d", value, maxWorkspaceUploadPathDepth)
	}
	for _, component := range components {
		if component == "" || component == "." || component == ".." {
			return fmt.Errorf("proto upload path %q contains an invalid component", value)
		}
		if len(component) > maxWorkspaceUploadComponentBytes {
			return fmt.Errorf("proto upload path %q has a component over %d bytes", value, maxWorkspaceUploadComponentBytes)
		}
		if strings.HasSuffix(component, ".") || strings.HasSuffix(component, " ") || workspaceUploadWindowsDeviceName(component) {
			return fmt.Errorf("proto upload path %q is not portable across supported hosts", value)
		}
		for _, character := range component {
			if unicode.IsControl(character) {
				return fmt.Errorf("proto upload path %q contains a control character", value)
			}
		}
	}
	return nil
}

func workspaceUploadWindowsDeviceName(component string) bool {
	base := component
	if dot := strings.IndexByte(base, '.'); dot >= 0 {
		base = base[:dot]
	}
	base = strings.ToUpper(base)
	switch base {
	case "CON", "PRN", "AUX", "NUL":
		return true
	}
	if len(base) == 4 && (strings.HasPrefix(base, "COM") || strings.HasPrefix(base, "LPT")) {
		return base[3] >= '1' && base[3] <= '9'
	}
	return false
}

func readWorkspaceUploadFile(ctx context.Context, part *multipart.Part, file workspaceUploadManifestFile) ([]byte, error) {
	defer func() { _ = part.Close() }()
	var contents bytes.Buffer
	contents.Grow(int(file.Size))
	if err := copyWorkspaceUploadFile(ctx, &contents, part, file.Size); err != nil {
		return nil, fmt.Errorf("read uploaded proto %q: %w", file.Path, err)
	}
	return contents.Bytes(), nil
}

func copyWorkspaceUploadFile(ctx context.Context, destination io.Writer, source io.Reader, expected int64) error {
	reader := &workspaceUploadContextReader{ctx: ctx, reader: source}
	written, err := io.CopyN(destination, reader, expected)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return err
		}
		return fmt.Errorf("declared %d bytes but received %d", expected, written)
	}
	var extra [1]byte
	count, err := reader.Read(extra[:])
	if count != 0 {
		return fmt.Errorf("declared %d bytes but received more", expected)
	}
	if err != io.EOF {
		if err == nil {
			return fmt.Errorf("declared %d bytes but upload did not end", expected)
		}
		return err
	}
	return nil
}

type workspaceUploadContextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r *workspaceUploadContextReader) Read(buffer []byte) (int, error) {
	select {
	case <-r.ctx.Done():
		return 0, r.ctx.Err()
	default:
		return r.reader.Read(buffer)
	}
}

func loadUploadedWorkspaceDescriptors(contents map[string][]byte, paths []string) ([]*desc.MethodDescriptor, []*desc.FileDescriptor, grpcurl.DescriptorSource, error) {
	parser := protoparse.Parser{
		Accessor: func(name string) (io.ReadCloser, error) {
			if err := validateWorkspaceUploadPath(name); err != nil {
				return nil, fmt.Errorf("import path %q is not allowed", name)
			}
			contents, ok := contents[name]
			if !ok {
				return nil, os.ErrNotExist
			}
			return io.NopCloser(bytes.NewReader(contents)), nil
		},
		IncludeSourceCodeInfo: true,
	}
	descriptors, err := parser.ParseFiles(paths...)
	if err != nil {
		return nil, nil, nil, err
	}
	source, err := grpcurl.DescriptorSourceFromFileDescriptors(descriptors...)
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
}

func clearWorkspaceUploadContents(contents map[string][]byte) {
	for name, value := range contents {
		clear(value)
		delete(contents, name)
	}
}

func sanitizeWorkspaceUploadError(err error) error {
	return fmt.Errorf("uploaded proto schema is invalid: %s", err)
}
