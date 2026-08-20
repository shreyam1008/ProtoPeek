package standalone

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/fullstorydev/grpcurl"
	legacyproto "github.com/golang/protobuf/proto"
	"github.com/jhump/protoreflect/desc"
)

const (
	maxWorkspaceConcurrentSchemaConnects       = 2
	maxWorkspaceSchemaProtoFiles               = 128
	maxWorkspaceSchemaImportPaths              = 64
	maxWorkspaceSchemaProtosets                = 32
	maxWorkspaceSchemaPathBytes                = 4096
	maxWorkspaceSchemaPathAggregateBytes       = 32 << 10
	maxWorkspaceSchemaFileBytes          int64 = 4 << 20
	maxWorkspaceSchemaFileAggregateBytes int64 = 16 << 20
	maxWorkspaceSchemaServices                 = 512
	maxWorkspaceSchemaMethods                  = 10000
	maxWorkspaceSchemaFiles                    = 1024
	maxWorkspaceSchemaMessages                 = 10000
	maxWorkspaceSchemaFields                   = 50000
	maxWorkspaceSchemaEnums                    = 4096
	maxWorkspaceSchemaEnumValues               = 50000
	maxWorkspaceSchemaMessageDepth             = 32
	maxWorkspaceSchemaDescriptorBytes    int64 = 8 << 20
	maxWorkspaceSchemaCatalogBytes       int64 = 16 << 20
)

type workspaceSchemaLimits struct {
	maxProtoFiles         int
	maxImportPaths        int
	maxProtosets          int
	maxPathBytes          int
	maxPathAggregateBytes int
	maxFileBytes          int64
	maxFileAggregateBytes int64
	maxServices           int
	maxMethods            int
	maxFiles              int
	maxMessages           int
	maxFields             int
	maxEnums              int
	maxEnumValues         int
	maxMessageDepth       int
	maxDescriptorBytes    int64
	maxCatalogBytes       int64
}

func defaultWorkspaceSchemaLimits() workspaceSchemaLimits {
	return workspaceSchemaLimits{
		maxProtoFiles:         maxWorkspaceSchemaProtoFiles,
		maxImportPaths:        maxWorkspaceSchemaImportPaths,
		maxProtosets:          maxWorkspaceSchemaProtosets,
		maxPathBytes:          maxWorkspaceSchemaPathBytes,
		maxPathAggregateBytes: maxWorkspaceSchemaPathAggregateBytes,
		maxFileBytes:          maxWorkspaceSchemaFileBytes,
		maxFileAggregateBytes: maxWorkspaceSchemaFileAggregateBytes,
		maxServices:           maxWorkspaceSchemaServices,
		maxMethods:            maxWorkspaceSchemaMethods,
		maxFiles:              maxWorkspaceSchemaFiles,
		maxMessages:           maxWorkspaceSchemaMessages,
		maxFields:             maxWorkspaceSchemaFields,
		maxEnums:              maxWorkspaceSchemaEnums,
		maxEnumValues:         maxWorkspaceSchemaEnumValues,
		maxMessageDepth:       maxWorkspaceSchemaMessageDepth,
		maxDescriptorBytes:    maxWorkspaceSchemaDescriptorBytes,
		maxCatalogBytes:       maxWorkspaceSchemaCatalogBytes,
	}
}

type workspaceSchemaLimitError struct {
	message string
}

func (err *workspaceSchemaLimitError) Error() string {
	return err.message
}

func workspaceSchemaLimit(message string) error {
	return &workspaceSchemaLimitError{message: message}
}

type workspaceSchemaBusyError struct{}

func (*workspaceSchemaBusyError) Error() string {
	return "workspace schema connection capacity is busy; retry shortly"
}

func validateWorkspaceSchemaPaths(cfg WorkspaceTargetConfig, limits workspaceSchemaLimits) error {
	if len(cfg.ProtoFiles) > limits.maxProtoFiles {
		return workspaceSchemaLimit(fmt.Sprintf("host schema exceeds the %d proto file path limit", limits.maxProtoFiles))
	}
	if len(cfg.ImportPaths) > limits.maxImportPaths {
		return workspaceSchemaLimit(fmt.Sprintf("host schema exceeds the %d import path limit", limits.maxImportPaths))
	}
	if len(cfg.Protosets) > limits.maxProtosets {
		return workspaceSchemaLimit(fmt.Sprintf("host schema exceeds the %d protoset path limit", limits.maxProtosets))
	}

	total := 0
	for _, entry := range []struct {
		label string
		paths []string
	}{
		{label: "proto file", paths: cfg.ProtoFiles},
		{label: "import", paths: cfg.ImportPaths},
		{label: "protoset", paths: cfg.Protosets},
	} {
		for _, schemaPath := range entry.paths {
			if !utf8.ValidString(schemaPath) || strings.ContainsRune(schemaPath, 0) {
				return fmt.Errorf("host schema %s path must be valid UTF-8 without NUL bytes", entry.label)
			}
			pathBytes := len(schemaPath)
			if pathBytes > limits.maxPathBytes {
				return workspaceSchemaLimit(fmt.Sprintf("host schema exceeds the %d byte path limit", limits.maxPathBytes))
			}
			if pathBytes > limits.maxPathAggregateBytes-total {
				return workspaceSchemaLimit(fmt.Sprintf("host schema exceeds the %d byte aggregate path limit", limits.maxPathAggregateBytes))
			}
			total += pathBytes
		}
	}
	return nil
}

func preflightWorkspaceSchemaFiles(ctx context.Context, cfg WorkspaceTargetConfig, limits workspaceSchemaLimits) error {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := validateWorkspaceSchemaPaths(cfg, limits); err != nil {
		return err
	}

	var paths []string
	switch cfg.SchemaSource {
	case "proto-files":
		paths = cfg.ProtoFiles
	case "protoset":
		paths = cfg.Protosets
	default:
		return nil
	}

	var total int64
	for _, schemaPath := range paths {
		if err := ctx.Err(); err != nil {
			return err
		}
		info, err := os.Stat(schemaPath)
		if err != nil {
			return fmt.Errorf("inspect host schema file %q: %w", schemaPath, err)
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("host schema path %q is not a regular file", schemaPath)
		}
		fileBytes := info.Size()
		if fileBytes > limits.maxFileBytes {
			return workspaceSchemaLimit(fmt.Sprintf("host schema file %q exceeds the %d byte per-file limit", schemaPath, limits.maxFileBytes))
		}
		if fileBytes > limits.maxFileAggregateBytes-total {
			return workspaceSchemaLimit(fmt.Sprintf("host schema exceeds the %d byte aggregate file limit", limits.maxFileAggregateBytes))
		}
		total += fileBytes
	}
	return ctx.Err()
}

func (m *WorkspaceManager) beginWorkspaceSchemaConnect(parent context.Context) (context.Context, func(), error) {
	if parent == nil {
		parent = context.Background()
	}
	if err := parent.Err(); err != nil {
		return nil, nil, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return nil, nil, fmt.Errorf("workspace manager is closed")
	}
	if len(m.activeSchemaConnects) >= maxWorkspaceConcurrentSchemaConnects {
		return nil, nil, &workspaceSchemaBusyError{}
	}

	ctx, cancel := context.WithCancel(parent)
	m.nextSchemaConnectID++
	id := m.nextSchemaConnectID
	m.activeSchemaConnects[id] = cancel
	var once sync.Once
	return ctx, func() {
		once.Do(func() {
			cancel()
			m.mu.Lock()
			delete(m.activeSchemaConnects, id)
			m.mu.Unlock()
		})
	}, nil
}

type workspaceSchemaResourceState struct {
	files map[string]*desc.FileDescriptor
	usage workspaceSchemaUsage
}

type workspaceSchemaUsage struct {
	services        int
	methods         int
	files           int
	descriptorBytes int64
	messages        int
	fields          int
	enums           int
	enumValues      int
	messageDepth    int
}

func newWorkspaceSchemaResourceState() *workspaceSchemaResourceState {
	return &workspaceSchemaResourceState{files: make(map[string]*desc.FileDescriptor)}
}

func (state *workspaceSchemaResourceState) addFileGraph(ctx context.Context, root *desc.FileDescriptor, limits workspaceSchemaLimits) error {
	if root == nil {
		return fmt.Errorf("schema contains a nil file descriptor")
	}
	stack := []*desc.FileDescriptor{root}
	for len(stack) > 0 {
		if err := ctx.Err(); err != nil {
			return err
		}
		last := len(stack) - 1
		file := stack[last]
		stack = stack[:last]
		name := file.GetName()
		if _, exists := state.files[name]; exists {
			continue
		}
		serviceCount := len(file.GetServices())
		methodCount := 0
		for _, service := range file.GetServices() {
			methodCount += len(service.GetMethods())
		}
		structure, err := workspaceFileStructureUsage(ctx, file, limits)
		if err != nil {
			return err
		}
		descriptorBytes := int64(legacyproto.Size(file.AsFileDescriptorProto()))
		nextUsage := workspaceSchemaUsage{
			services:        state.usage.services + serviceCount,
			methods:         state.usage.methods + methodCount,
			files:           state.usage.files + 1,
			descriptorBytes: state.usage.descriptorBytes + descriptorBytes,
			messages:        state.usage.messages + structure.messages,
			fields:          state.usage.fields + structure.fields,
			enums:           state.usage.enums + structure.enums,
			enumValues:      state.usage.enumValues + structure.enumValues,
			messageDepth:    max(state.usage.messageDepth, structure.messageDepth),
		}
		if err := validateWorkspaceSchemaUsage(nextUsage, limits); err != nil {
			return err
		}

		state.files[name] = file
		state.usage = nextUsage
		stack = append(stack, file.GetDependencies()...)
	}
	return nil
}

type workspaceMessageDepth struct {
	message *desc.MessageDescriptor
	depth   int
}

func workspaceFileStructureUsage(ctx context.Context, file *desc.FileDescriptor, limits workspaceSchemaLimits) (workspaceSchemaUsage, error) {
	usage := workspaceSchemaUsage{}
	for _, enum := range file.GetEnumTypes() {
		usage.enums++
		usage.enumValues += len(enum.GetValues())
	}
	stack := make([]workspaceMessageDepth, 0, len(file.GetMessageTypes()))
	for _, message := range file.GetMessageTypes() {
		stack = append(stack, workspaceMessageDepth{message: message, depth: 1})
	}
	for len(stack) > 0 {
		if err := ctx.Err(); err != nil {
			return workspaceSchemaUsage{}, err
		}
		last := len(stack) - 1
		current := stack[last]
		stack = stack[:last]
		if current.depth > limits.maxMessageDepth {
			return workspaceSchemaUsage{}, workspaceSchemaLimit(fmt.Sprintf("workspace schema exceeds the %d message nesting depth limit", limits.maxMessageDepth))
		}
		usage.messages++
		usage.fields += len(current.message.GetFields())
		usage.messageDepth = max(usage.messageDepth, current.depth)
		for _, enum := range current.message.GetNestedEnumTypes() {
			usage.enums++
			usage.enumValues += len(enum.GetValues())
		}
		for _, nested := range current.message.GetNestedMessageTypes() {
			stack = append(stack, workspaceMessageDepth{message: nested, depth: current.depth + 1})
		}
		if err := validateWorkspaceSchemaUsage(usage, limits); err != nil {
			return workspaceSchemaUsage{}, err
		}
	}
	if err := validateWorkspaceSchemaUsage(usage, limits); err != nil {
		return workspaceSchemaUsage{}, err
	}
	return usage, nil
}

func validateWorkspaceSchemaUsage(usage workspaceSchemaUsage, limits workspaceSchemaLimits) error {
	if usage.services > limits.maxServices {
		return workspaceSchemaLimit(fmt.Sprintf("workspace schema exceeds the %d service limit", limits.maxServices))
	}
	if usage.methods > limits.maxMethods {
		return workspaceSchemaLimit(fmt.Sprintf("workspace schema exceeds the %d method limit", limits.maxMethods))
	}
	if usage.files > limits.maxFiles {
		return workspaceSchemaLimit(fmt.Sprintf("workspace schema exceeds the %d file limit", limits.maxFiles))
	}
	if usage.descriptorBytes > limits.maxDescriptorBytes {
		return workspaceSchemaLimit(fmt.Sprintf("workspace schema exceeds the %d byte descriptor limit", limits.maxDescriptorBytes))
	}
	if usage.messages > limits.maxMessages {
		return workspaceSchemaLimit(fmt.Sprintf("workspace schema exceeds the %d message limit", limits.maxMessages))
	}
	if usage.fields > limits.maxFields {
		return workspaceSchemaLimit(fmt.Sprintf("workspace schema exceeds the %d field limit", limits.maxFields))
	}
	if usage.enums > limits.maxEnums {
		return workspaceSchemaLimit(fmt.Sprintf("workspace schema exceeds the %d enum limit", limits.maxEnums))
	}
	if usage.enumValues > limits.maxEnumValues {
		return workspaceSchemaLimit(fmt.Sprintf("workspace schema exceeds the %d enum value limit", limits.maxEnumValues))
	}
	if usage.messageDepth > limits.maxMessageDepth {
		return workspaceSchemaLimit(fmt.Sprintf("workspace schema exceeds the %d message nesting depth limit", limits.maxMessageDepth))
	}
	return nil
}

func (state *workspaceSchemaResourceState) sortedFiles() []*desc.FileDescriptor {
	files := make([]*desc.FileDescriptor, 0, len(state.files))
	for _, file := range state.files {
		files = append(files, file)
	}
	sort.Slice(files, func(left, right int) bool {
		return files[left].GetName() < files[right].GetName()
	})
	return files
}

func validateWorkspaceSchemaResources(ctx context.Context, methods []*desc.MethodDescriptor, files []*desc.FileDescriptor, limits workspaceSchemaLimits) error {
	if ctx == nil {
		ctx = context.Background()
	}
	if len(methods) > limits.maxMethods {
		return workspaceSchemaLimit(fmt.Sprintf("workspace schema exceeds the %d method limit", limits.maxMethods))
	}
	state := newWorkspaceSchemaResourceState()
	for _, file := range files {
		if err := state.addFileGraph(ctx, file, limits); err != nil {
			return err
		}
	}
	return ctx.Err()
}

func validateWorkspaceSchemaCatalog(catalog []byte, limits workspaceSchemaLimits) error {
	return validateWorkspaceSchemaCatalogBytes(int64(len(catalog)), limits)
}

func validateWorkspaceSchemaCatalogBytes(catalogBytes int64, limits workspaceSchemaLimits) error {
	if catalogBytes > limits.maxCatalogBytes {
		return workspaceSchemaLimit(fmt.Sprintf("workspace schema exceeds the %d byte catalog limit", limits.maxCatalogBytes))
	}
	return nil
}

func loadReflectionWorkspaceDescriptors(ctx context.Context, source grpcurl.DescriptorSource, limits workspaceSchemaLimits) ([]*desc.MethodDescriptor, []*desc.FileDescriptor, grpcurl.DescriptorSource, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	serviceNames, err := source.ListServices()
	if err != nil {
		return nil, nil, nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, nil, nil, err
	}
	if len(serviceNames) > limits.maxServices+2 {
		return nil, nil, nil, workspaceSchemaLimit(fmt.Sprintf("workspace schema exceeds the %d service limit", limits.maxServices))
	}
	filtered := make([]string, 0, min(len(serviceNames), limits.maxServices))
	seenServices := make(map[string]struct{}, min(len(serviceNames), limits.maxServices))
	for _, serviceName := range serviceNames {
		if isReflectionService(serviceName) {
			continue
		}
		if _, exists := seenServices[serviceName]; exists {
			continue
		}
		seenServices[serviceName] = struct{}{}
		filtered = append(filtered, serviceName)
		if len(filtered) > limits.maxServices {
			return nil, nil, nil, workspaceSchemaLimit(fmt.Sprintf("workspace schema exceeds the %d service limit", limits.maxServices))
		}
	}
	sort.Strings(filtered)

	state := newWorkspaceSchemaResourceState()
	methods := make([]*desc.MethodDescriptor, 0)
	for _, serviceName := range filtered {
		if err := ctx.Err(); err != nil {
			return nil, nil, nil, err
		}
		descriptor, err := findWorkspaceSchemaSymbol(state.files, serviceName)
		if err != nil {
			descriptor, err = source.FindSymbol(serviceName)
		}
		if err != nil {
			return nil, nil, nil, err
		}
		service, ok := descriptor.(*desc.ServiceDescriptor)
		if !ok {
			return nil, nil, nil, fmt.Errorf("%s resolved to %T instead of a service descriptor", serviceName, descriptor)
		}
		if err := state.addFileGraph(ctx, service.GetFile(), limits); err != nil {
			return nil, nil, nil, err
		}
		if len(service.GetMethods()) > limits.maxMethods-len(methods) {
			return nil, nil, nil, workspaceSchemaLimit(fmt.Sprintf("workspace schema exceeds the %d method limit", limits.maxMethods))
		}
		methods = append(methods, service.GetMethods()...)
	}
	files := state.sortedFiles()
	fileSource, err := grpcurl.DescriptorSourceFromFileDescriptors(files...)
	if err != nil {
		return nil, nil, nil, err
	}
	return methods, files, fileSource, nil
}

func loadLocalWorkspaceDescriptors(ctx context.Context, source grpcurl.DescriptorSource, limits workspaceSchemaLimits) ([]*desc.MethodDescriptor, []*desc.FileDescriptor, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	serviceNames, err := source.ListServices()
	if err != nil {
		return nil, nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	methods := make([]*desc.MethodDescriptor, 0)
	if len(serviceNames) > limits.maxServices+2 {
		return nil, nil, workspaceSchemaLimit(fmt.Sprintf("workspace schema exceeds the %d service limit", limits.maxServices))
	}
	seenServices := make(map[string]struct{}, min(len(serviceNames), limits.maxServices))
	for _, serviceName := range serviceNames {
		if isReflectionService(serviceName) {
			continue
		}
		if _, exists := seenServices[serviceName]; exists {
			continue
		}
		seenServices[serviceName] = struct{}{}
		if len(seenServices) > limits.maxServices {
			return nil, nil, workspaceSchemaLimit(fmt.Sprintf("workspace schema exceeds the %d service limit", limits.maxServices))
		}
		if err := ctx.Err(); err != nil {
			return nil, nil, err
		}
		descriptor, err := source.FindSymbol(serviceName)
		if err != nil {
			return nil, nil, err
		}
		service, ok := descriptor.(*desc.ServiceDescriptor)
		if !ok {
			return nil, nil, fmt.Errorf("%s resolved to %T instead of a service descriptor", serviceName, descriptor)
		}
		if len(service.GetMethods()) > limits.maxMethods-len(methods) {
			return nil, nil, workspaceSchemaLimit(fmt.Sprintf("workspace schema exceeds the %d method limit", limits.maxMethods))
		}
		methods = append(methods, service.GetMethods()...)
	}
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	files, err := grpcurl.GetAllFiles(source)
	if err != nil {
		return nil, nil, err
	}
	if err := validateWorkspaceSchemaResources(ctx, methods, files, limits); err != nil {
		return nil, nil, err
	}
	return methods, files, nil
}

func sanitizeWorkspaceSchemaLoadError(schemaSource string, err error) error {
	if err == nil {
		return nil
	}
	var limitErr *workspaceSchemaLimitError
	if errors.As(err, &limitErr) || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	switch schemaSource {
	case "reflection":
		if errors.Is(err, grpcurl.ErrReflectionNotSupported) {
			return fmt.Errorf("reflection schema is unavailable; enable server reflection or choose a proto/protoset source")
		}
		return fmt.Errorf("reflection schema could not be loaded; verify reflection access and descriptor validity")
	case "proto-files":
		return fmt.Errorf("host proto schema could not be loaded; verify the configured proto files, import paths, and schema syntax")
	case "protoset":
		return fmt.Errorf("host protoset schema could not be loaded; verify each configured file is a binary FileDescriptorSet")
	default:
		return fmt.Errorf("workspace schema could not be loaded")
	}
}

func findWorkspaceSchemaSymbol(files map[string]*desc.FileDescriptor, symbol string) (desc.Descriptor, error) {
	for _, file := range files {
		if descriptor := file.FindSymbol(symbol); descriptor != nil {
			return descriptor, nil
		}
	}
	return nil, fmt.Errorf("symbol %q is not loaded", symbol)
}

func isReflectionService(name string) bool {
	return name == "grpc.reflection.v1alpha.ServerReflection" || name == "grpc.reflection.v1.ServerReflection"
}
