package standalone

import (
	"encoding/json"
	"sort"
	"strings"

	"github.com/golang/protobuf/protoc-gen-go/descriptor"
	"github.com/jhump/protoreflect/desc"
	"github.com/jhump/protoreflect/desc/protoprint"
)

type protoCatalogResponse struct {
	Files []protoFileSummary `json:"files"`
}

type protoFileSummary struct {
	Name         string                `json:"name"`
	Package      string                `json:"package"`
	Dependencies []string              `json:"dependencies"`
	Services     []protoServiceSummary `json:"services"`
	Messages     []protoMessageSummary `json:"messages"`
	Enums        []protoEnumSummary    `json:"enums"`
	ProtoText    string                `json:"protoText"`
	WellKnown    bool                  `json:"wellKnown"`
}

type protoServiceSummary struct {
	Name     string               `json:"name"`
	FullName string               `json:"fullName"`
	Methods  []protoMethodSummary `json:"methods"`
}

type protoMethodSummary struct {
	Name            string `json:"name"`
	FullName        string `json:"fullName"`
	RequestType     string `json:"requestType"`
	ResponseType    string `json:"responseType"`
	ClientStreaming bool   `json:"clientStreaming"`
	ServerStreaming bool   `json:"serverStreaming"`
}

type protoMessageSummary struct {
	Name     string                `json:"name"`
	FullName string                `json:"fullName"`
	Fields   []protoFieldSummary   `json:"fields"`
	Messages []protoMessageSummary `json:"messages"`
	Enums    []protoEnumSummary    `json:"enums"`
}

type protoFieldSummary struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Label    string `json:"label"`
	Required bool   `json:"required"`
	Repeated bool   `json:"repeated"`
	Map      bool   `json:"map"`
	OneOf    string `json:"oneOf"`
}

type protoEnumSummary struct {
	Name     string           `json:"name"`
	FullName string           `json:"fullName"`
	Values   []protoEnumValue `json:"values"`
}

type protoEnumValue struct {
	Name   string `json:"name"`
	Number int32  `json:"number"`
}

var protoCatalogPrinter = protoprint.Printer{
	Indent: "  ",
}

func buildProtoCatalog(files []*desc.FileDescriptor) ([]byte, error) {
	sortedFiles := append([]*desc.FileDescriptor(nil), files...)
	sort.Slice(sortedFiles, func(i, j int) bool {
		return sortedFiles[i].GetName() < sortedFiles[j].GetName()
	})

	summaries := make([]protoFileSummary, 0, len(sortedFiles))
	for _, fd := range sortedFiles {
		protoText, err := protoCatalogPrinter.PrintProtoToString(fd)
		if err != nil {
			return nil, err
		}

		summary := protoFileSummary{
			Name:      fd.GetName(),
			Package:   fd.GetPackage(),
			ProtoText: strings.TrimSpace(protoText),
			WellKnown: strings.HasPrefix(fd.GetName(), "google/protobuf/"),
		}

		for _, dep := range fd.GetDependencies() {
			summary.Dependencies = append(summary.Dependencies, dep.GetName())
		}
		sort.Strings(summary.Dependencies)

		for _, sd := range fd.GetServices() {
			service := protoServiceSummary{
				Name:     sd.GetName(),
				FullName: sd.GetFullyQualifiedName(),
			}
			for _, md := range sd.GetMethods() {
				service.Methods = append(service.Methods, protoMethodSummary{
					Name:            md.GetName(),
					FullName:        md.GetFullyQualifiedName(),
					RequestType:     md.GetInputType().GetFullyQualifiedName(),
					ResponseType:    md.GetOutputType().GetFullyQualifiedName(),
					ClientStreaming: md.IsClientStreaming(),
					ServerStreaming: md.IsServerStreaming(),
				})
			}
			sort.Slice(service.Methods, func(i, j int) bool {
				return service.Methods[i].Name < service.Methods[j].Name
			})
			summary.Services = append(summary.Services, service)
		}

		for _, md := range fd.GetMessageTypes() {
			summary.Messages = append(summary.Messages, protoMessageSummaryFor(md))
		}

		for _, ed := range fd.GetEnumTypes() {
			summary.Enums = append(summary.Enums, protoEnumSummaryFor(ed))
		}

		sort.Slice(summary.Services, func(i, j int) bool {
			return summary.Services[i].Name < summary.Services[j].Name
		})
		sort.Slice(summary.Messages, func(i, j int) bool {
			return summary.Messages[i].Name < summary.Messages[j].Name
		})
		sort.Slice(summary.Enums, func(i, j int) bool {
			return summary.Enums[i].Name < summary.Enums[j].Name
		})

		summaries = append(summaries, summary)
	}

	return json.Marshal(protoCatalogResponse{Files: summaries})
}

func protoMessageSummaryFor(md *desc.MessageDescriptor) protoMessageSummary {
	summary := protoMessageSummary{
		Name:     md.GetName(),
		FullName: md.GetFullyQualifiedName(),
	}

	for _, field := range md.GetFields() {
		entry := protoFieldSummary{
			Name:     field.GetName(),
			Type:     protoFieldType(field),
			Label:    protoFieldLabel(field),
			Required: field.IsRequired(),
			Repeated: field.IsRepeated(),
			Map:      field.IsMap(),
		}
		if oneOf := field.GetOneOf(); oneOf != nil {
			entry.OneOf = oneOf.GetName()
		}
		summary.Fields = append(summary.Fields, entry)
	}
	sort.Slice(summary.Fields, func(i, j int) bool {
		return summary.Fields[i].Name < summary.Fields[j].Name
	})

	for _, nested := range md.GetNestedMessageTypes() {
		summary.Messages = append(summary.Messages, protoMessageSummaryFor(nested))
	}
	sort.Slice(summary.Messages, func(i, j int) bool {
		return summary.Messages[i].Name < summary.Messages[j].Name
	})

	for _, enum := range md.GetNestedEnumTypes() {
		summary.Enums = append(summary.Enums, protoEnumSummaryFor(enum))
	}
	sort.Slice(summary.Enums, func(i, j int) bool {
		return summary.Enums[i].Name < summary.Enums[j].Name
	})

	return summary
}

func protoEnumSummaryFor(ed *desc.EnumDescriptor) protoEnumSummary {
	summary := protoEnumSummary{
		Name:     ed.GetName(),
		FullName: ed.GetFullyQualifiedName(),
	}
	for _, value := range ed.GetValues() {
		summary.Values = append(summary.Values, protoEnumValue{
			Name:   value.GetName(),
			Number: value.GetNumber(),
		})
	}
	sort.Slice(summary.Values, func(i, j int) bool {
		return summary.Values[i].Number < summary.Values[j].Number
	})
	return summary
}

func protoFieldLabel(field *desc.FieldDescriptor) string {
	switch {
	case field.IsMap():
		return "map"
	case field.IsRepeated():
		return "repeated"
	case field.IsRequired():
		return "required"
	default:
		return "optional"
	}
}

func protoFieldType(field *desc.FieldDescriptor) string {
	switch {
	case field.GetMessageType() != nil:
		return field.GetMessageType().GetFullyQualifiedName()
	case field.GetEnumType() != nil:
		return field.GetEnumType().GetFullyQualifiedName()
	default:
		return protoScalarType(field.GetType())
	}
}

func protoScalarType(fieldType descriptor.FieldDescriptorProto_Type) string {
	switch fieldType {
	case descriptor.FieldDescriptorProto_TYPE_DOUBLE:
		return "double"
	case descriptor.FieldDescriptorProto_TYPE_FLOAT:
		return "float"
	case descriptor.FieldDescriptorProto_TYPE_INT64:
		return "int64"
	case descriptor.FieldDescriptorProto_TYPE_UINT64:
		return "uint64"
	case descriptor.FieldDescriptorProto_TYPE_INT32:
		return "int32"
	case descriptor.FieldDescriptorProto_TYPE_FIXED64:
		return "fixed64"
	case descriptor.FieldDescriptorProto_TYPE_FIXED32:
		return "fixed32"
	case descriptor.FieldDescriptorProto_TYPE_BOOL:
		return "bool"
	case descriptor.FieldDescriptorProto_TYPE_STRING:
		return "string"
	case descriptor.FieldDescriptorProto_TYPE_BYTES:
		return "bytes"
	case descriptor.FieldDescriptorProto_TYPE_UINT32:
		return "uint32"
	case descriptor.FieldDescriptorProto_TYPE_SFIXED32:
		return "sfixed32"
	case descriptor.FieldDescriptorProto_TYPE_SFIXED64:
		return "sfixed64"
	case descriptor.FieldDescriptorProto_TYPE_SINT32:
		return "sint32"
	case descriptor.FieldDescriptorProto_TYPE_SINT64:
		return "sint64"
	default:
		return strings.TrimPrefix(fieldType.String(), "TYPE_")
	}
}
