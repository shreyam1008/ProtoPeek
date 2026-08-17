package standalone

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/jhump/protoreflect/desc"
	"github.com/jhump/protoreflect/desc/builder"
	"github.com/jhump/protoreflect/desc/protoprint"
)

type bootstrapMetadata struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type bootstrapTargetDefaults struct {
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

type bootstrapMethod struct {
	Name            string `json:"name"`
	FullName        string `json:"fullName"`
	Description     string `json:"description"`
	ClientStreaming bool   `json:"clientStreaming"`
	ServerStreaming bool   `json:"serverStreaming"`
	RequestType     string `json:"requestType"`
	ResponseType    string `json:"responseType"`
}

type bootstrapService struct {
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Methods     []bootstrapMethod `json:"methods"`
}

type bootstrapResponse struct {
	AppName         string                  `json:"appName"`
	Version         string                  `json:"version"`
	Target          string                  `json:"target"`
	LauncherMode    bool                    `json:"launcherMode"`
	BasePath        string                  `json:"basePath"`
	DocsURL         string                  `json:"docsURL"`
	RepoURL         string                  `json:"repoURL"`
	LearnURL        string                  `json:"learnURL"`
	GRPCWebURL      string                  `json:"grpcWebURL"`
	DebuggingURL    string                  `json:"debuggingURL"`
	AuthorName      string                  `json:"authorName"`
	AuthorURL       string                  `json:"authorURL"`
	DefaultMetadata []bootstrapMetadata     `json:"defaultMetadata"`
	TargetDefaults  bootstrapTargetDefaults `json:"targetDefaults"`
	GRPCurlOptions  string                  `json:"grpcurlOptions"`
	Services        []bootstrapService      `json:"services"`
}

var bootstrapProtoPrinter = protoprint.Printer{
	Compact: true,
	Indent:  "  ",
}

func buildBootstrap(target string, methods []*desc.MethodDescriptor, opts *handlerOptions) ([]byte, error) {
	servicesByName := map[string]*bootstrapService{}

	for _, md := range methods {
		sd := md.GetService()
		name := sd.GetFullyQualifiedName()
		service, ok := servicesByName[name]
		if !ok {
			service = &bootstrapService{
				Name:        name,
				Description: serviceDescription(sd),
			}
			servicesByName[name] = service
		}

		service.Methods = append(service.Methods, bootstrapMethod{
			Name:            md.GetName(),
			FullName:        md.GetFullyQualifiedName(),
			Description:     methodDescription(md),
			ClientStreaming: md.IsClientStreaming(),
			ServerStreaming: md.IsServerStreaming(),
			RequestType:     md.GetInputType().GetFullyQualifiedName(),
			ResponseType:    md.GetOutputType().GetFullyQualifiedName(),
		})
	}

	serviceNames := make([]string, 0, len(servicesByName))
	for name := range servicesByName {
		serviceNames = append(serviceNames, name)
	}
	sort.Strings(serviceNames)

	services := make([]bootstrapService, 0, len(serviceNames))
	for _, name := range serviceNames {
		service := servicesByName[name]
		sort.Slice(service.Methods, func(i, j int) bool {
			return service.Methods[i].Name < service.Methods[j].Name
		})
		services = append(services, *service)
	}

	defaultMetadata := make([]bootstrapMetadata, 0, len(opts.defaultMetadata))
	for _, header := range opts.defaultMetadata {
		parts := strings.SplitN(header, ":", 2)
		item := bootstrapMetadata{
			Name: strings.TrimSpace(parts[0]),
		}
		if len(parts) > 1 {
			item.Value = strings.TrimSpace(parts[1])
		}
		defaultMetadata = append(defaultMetadata, item)
	}

	return json.Marshal(bootstrapResponse{
		AppName:         "ProtoPeek",
		Version:         opts.version,
		Target:          target,
		LauncherMode:    opts.launcherMode,
		BasePath:        opts.basePath,
		DocsURL:         "https://protopeek.shreyam1008.com.np/docs/",
		RepoURL:         "https://github.com/shreyam1008/ProtoPeek",
		LearnURL:        "https://protopeek.shreyam1008.com.np/learn-grpc/",
		GRPCWebURL:      "https://grpc.io/docs/platforms/web/basics/",
		DebuggingURL:    "https://grpc.io/docs/guides/debugging/",
		AuthorName:      "Shreyam Adhikari",
		AuthorURL:       "https://shreyam1008.com.np/",
		DefaultMetadata: defaultMetadata,
		TargetDefaults: bootstrapTargetDefaults{
			Plaintext:    opts.targetDefaults.Plaintext,
			Insecure:     opts.targetDefaults.Insecure,
			Authority:    opts.targetDefaults.Authority,
			CACertPath:   opts.targetDefaults.CACertPath,
			CertPath:     opts.targetDefaults.CertPath,
			KeyPath:      opts.targetDefaults.KeyPath,
			SchemaSource: opts.targetDefaults.SchemaSource,
			ProtoFiles:   append([]string{}, opts.targetDefaults.ProtoFiles...),
			ImportPaths:  append([]string{}, opts.targetDefaults.ImportPaths...),
			Protosets:    append([]string{}, opts.targetDefaults.Protosets...),
		},
		GRPCurlOptions: strings.Join(opts.gRPCurlOptions, " "),
		Services:       services,
	})
}

func methodDescription(md *desc.MethodDescriptor) string {
	description, err := bootstrapProtoPrinter.PrintProtoToString(md)
	if err == nil {
		return strings.TrimSpace(description)
	}

	reqPrefix := ""
	respPrefix := ""
	if md.IsClientStreaming() {
		reqPrefix = "stream "
	}
	if md.IsServerStreaming() {
		respPrefix = "stream "
	}
	return fmt.Sprintf(
		"rpc %s (%s%s) returns (%s%s);",
		md.GetName(),
		reqPrefix,
		md.GetInputType().GetFullyQualifiedName(),
		respPrefix,
		md.GetOutputType().GetFullyQualifiedName(),
	)
}

func serviceDescription(sd *desc.ServiceDescriptor) string {
	sb, err := builder.FromService(sd)
	if err != nil {
		return fmt.Sprintf("service %s { ... }", sd.GetName())
	}

	for _, md := range sd.GetMethods() {
		sb.RemoveMethod(md.GetName())
	}

	stripped, err := sb.Build()
	if err != nil {
		return fmt.Sprintf("service %s { ... }", sd.GetName())
	}

	description, err := bootstrapProtoPrinter.PrintProtoToString(stripped)
	if err != nil {
		return fmt.Sprintf("service %s { ... }", sd.GetName())
	}

	return strings.TrimSpace(description)
}
