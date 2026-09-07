// Package capnpwork implements schema-driven Cap'n Proto inspection without
// code generation or a C++ runtime in the request path.
package capnpwork

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"sort"
	"strconv"
	"unicode"
	"unicode/utf8"

	"capnproto.org/go/capnp/v3"
	"capnproto.org/go/capnp/v3/std/capnp/schema"
)

const MaxSchemaBytes = 2 << 20
const MaxBodyBytes = 64 << 10
const maxNodes = 1024
const maxFields = 256
const maxDepth = 16

type Schema struct {
	message *capnp.Message
	nodes   map[uint64]schema.Node
}

type Method struct {
	InterfaceID   string  `json:"interfaceId"`
	InterfaceName string  `json:"interfaceName"`
	Ordinal       uint16  `json:"ordinal"`
	Name          string  `json:"name"`
	ParamsID      string  `json:"paramsId"`
	ResultsID     string  `json:"resultsId"`
	Fields        []Field `json:"fields"`
}

type Field struct {
	Name  string `json:"name"`
	Type  string `json:"type"`
	Union bool   `json:"union"`
}

type Description struct {
	Methods   []Method `json:"methods"`
	NodeCount int      `json:"nodeCount"`
}

// Parse accepts the standard uncompressed CodeGeneratorRequest emitted by
// `capnp compile -o- schema.capnp`. No imported files or network I/O are used.
func Parse(raw []byte) (*Schema, error) {
	if len(raw) == 0 || len(raw) > MaxSchemaBytes {
		return nil, errors.New("compiled schema must be between 1 byte and 2 MiB")
	}
	r := bytes.NewReader(raw)
	d := capnp.NewDecoder(r)
	d.MaxMessageSize = MaxSchemaBytes
	msg, err := d.Decode()
	if err != nil {
		return nil, fmt.Errorf("decode compiled schema: %w", err)
	}
	msg.TraverseLimit, msg.DepthLimit = 16<<20, 32
	s := &Schema{message: msg, nodes: make(map[uint64]schema.Node)}
	fail := func(err error) (*Schema, error) { s.Close(); return nil, err }
	if r.Len() != 0 {
		return fail(errors.New("compiled schema must contain exactly one message"))
	}
	request, err := schema.ReadRootCodeGeneratorRequest(msg)
	if err != nil {
		return fail(err)
	}
	nodes, err := request.Nodes()
	if err != nil || nodes.Len() == 0 || nodes.Len() > maxNodes {
		return fail(errors.New("compiled schema must contain 1–1024 nodes"))
	}
	for i := 0; i < nodes.Len(); i++ {
		n := nodes.At(i)
		name, err := n.DisplayName()
		if err != nil || !safeLabel(name, 512) || n.Id() == 0 {
			return fail(errors.New("invalid schema node identity"))
		}
		if _, exists := s.nodes[n.Id()]; exists {
			return fail(errors.New("duplicate schema node ID"))
		}
		s.nodes[n.Id()] = n
	}
	for _, n := range s.nodes {
		if err := s.validateNode(n); err != nil {
			return fail(err)
		}
	}
	return s, nil
}

func (s *Schema) Close() { s.message.Release() }

func safeLabel(value string, limit int) bool {
	if value == "" || len(value) > limit || !utf8.ValidString(value) {
		return false
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

func (s *Schema) structNode(id uint64) (schema.Node, error) {
	n, ok := s.nodes[id]
	if !ok || n.Which() != schema.Node_Which_structNode {
		return schema.Node{}, fmt.Errorf("missing struct schema 0x%x", id)
	}
	return n, nil
}

func objectSize(n schema.Node) capnp.ObjectSize {
	return capnp.ObjectSize{DataSize: capnp.Size(n.StructNode().DataWordCount()) * 8, PointerCount: n.StructNode().PointerCount()}
}

func (s *Schema) validateNode(n schema.Node) error {
	switch n.Which() {
	case schema.Node_Which_structNode:
		st := n.StructNode()
		if st.DataWordCount() > 4096 || st.PointerCount() > 1024 {
			return errors.New("schema struct exceeds workbench size limit")
		}
		if st.DiscriminantCount() > 0 && uint64(st.DiscriminantOffset())*2+2 > uint64(st.DataWordCount())*8 {
			return errors.New("union discriminant is outside its struct")
		}
		fields, err := st.Fields()
		if err != nil || fields.Len() > maxFields {
			return errors.New("invalid or oversized struct fields")
		}
		seen := map[string]bool{}
		for i := 0; i < fields.Len(); i++ {
			f := fields.At(i)
			name, err := f.Name()
			if err != nil || !safeLabel(name, 128) || seen[name] {
				return errors.New("invalid or duplicate field name")
			}
			seen[name] = true
			if dv := f.DiscriminantValue(); dv != schema.Field_noDiscriminant && dv >= st.DiscriminantCount() {
				return errors.New("invalid union discriminant value")
			}
			switch f.Which() {
			case schema.Field_Which_group:
				group, err := s.structNode(f.Group().TypeId())
				if err != nil || !group.StructNode().IsGroup() || objectSize(group) != objectSize(n) {
					return errors.New("group does not match its containing struct")
				}
			case schema.Field_Which_slot:
				typ, err := f.Slot().Type()
				if err != nil {
					return err
				}
				if _, err := s.typeName(typ, 0); err != nil {
					return err
				}
				dv, err := f.Slot().DefaultValue()
				if err != nil || !dv.IsValid() || uint16(dv.Which()) != uint16(typ.Which()) {
					return errors.New("field default does not match its type")
				}
				bits := typeBits(typ.Which())
				if bits > 0 && (uint64(f.Slot().Offset())+1)*uint64(bits) > uint64(st.DataWordCount())*64 {
					return errors.New("field offset is outside struct data")
				}
				if bits < 0 && f.Slot().Offset() >= uint32(st.PointerCount()) {
					return errors.New("field offset is outside struct pointers")
				}
			default:
				return errors.New("unknown schema field kind")
			}
		}
	case schema.Node_Which_interface:
		methods, err := n.Interface().Methods()
		if err != nil || methods.Len() > 128 {
			return errors.New("interface has more than 128 methods or invalid method data")
		}
		for i := 0; i < methods.Len(); i++ {
			m := methods.At(i)
			name, err := m.Name()
			if err != nil || !safeLabel(name, 128) {
				return errors.New("invalid method name")
			}
			if _, err := s.structNode(m.ParamStructType()); err != nil {
				return err
			}
			if _, err := s.structNode(m.ResultStructType()); err != nil {
				return err
			}
		}
	case schema.Node_Which_enum:
		values, err := n.Enum().Enumerants()
		if err != nil || values.Len() > 1024 {
			return errors.New("invalid or oversized enum")
		}
		for i := 0; i < values.Len(); i++ {
			name, err := values.At(i).Name()
			if err != nil || !safeLabel(name, 128) {
				return errors.New("invalid enum label")
			}
		}
	case schema.Node_Which_file, schema.Node_Which_const, schema.Node_Which_annotation:
	default:
		return errors.New("unknown schema node kind")
	}
	return nil
}

func typeBits(kind schema.Type_Which) int {
	switch kind {
	case schema.Type_Which_void:
		return 0
	case schema.Type_Which_bool:
		return 1
	case schema.Type_Which_int8, schema.Type_Which_uint8:
		return 8
	case schema.Type_Which_int16, schema.Type_Which_uint16, schema.Type_Which_enum:
		return 16
	case schema.Type_Which_int32, schema.Type_Which_uint32, schema.Type_Which_float32:
		return 32
	case schema.Type_Which_int64, schema.Type_Which_uint64, schema.Type_Which_float64:
		return 64
	default:
		return -1
	}
}

func (s *Schema) typeName(t schema.Type, depth int) (string, error) {
	if depth > maxDepth {
		return "", errors.New("schema type nesting exceeds 16")
	}
	switch t.Which() {
	case schema.Type_Which_list:
		element, err := t.List().ElementType()
		if err != nil {
			return "", err
		}
		name, err := s.typeName(element, depth+1)
		return "List(" + name + ")", err
	case schema.Type_Which_structType, schema.Type_Which_enum, schema.Type_Which_interface:
		var id uint64
		var kind schema.Node_Which
		switch t.Which() {
		case schema.Type_Which_structType:
			id, kind = t.StructType().TypeId(), schema.Node_Which_structNode
		case schema.Type_Which_enum:
			id, kind = t.Enum().TypeId(), schema.Node_Which_enum
		case schema.Type_Which_interface:
			id, kind = t.Interface().TypeId(), schema.Node_Which_interface
		}
		n, ok := s.nodes[id]
		if !ok || n.Which() != kind {
			return "", errors.New("missing or mismatched referenced schema type")
		}
		return n.DisplayName()
	default:
		if t.Which() > schema.Type_Which_anyPointer {
			return "", errors.New("unknown schema type")
		}
		return t.Which().String(), nil
	}
}

func (s *Schema) Describe() (Description, error) {
	result := Description{Methods: []Method{}, NodeCount: len(s.nodes)}
	for _, n := range s.nodes {
		if n.Which() != schema.Node_Which_interface {
			continue
		}
		name, _ := n.DisplayName()
		methods, err := n.Interface().Methods()
		if err != nil {
			return result, err
		}
		for i := 0; i < methods.Len(); i++ {
			if len(result.Methods) >= 256 {
				return result, errors.New("schema contains more than 256 methods")
			}
			m := methods.At(i)
			methodName, _ := m.Name()
			item := Method{InterfaceID: fmt.Sprintf("0x%x", n.Id()), InterfaceName: name, Ordinal: uint16(i), Name: methodName, ParamsID: fmt.Sprintf("0x%x", m.ParamStructType()), ResultsID: fmt.Sprintf("0x%x", m.ResultStructType()), Fields: []Field{}}
			params, err := s.structNode(m.ParamStructType())
			if err != nil {
				return result, err
			}
			fields, err := params.StructNode().Fields()
			if err != nil {
				return result, err
			}
			for j := 0; j < fields.Len(); j++ {
				f := fields.At(j)
				label, _ := f.Name()
				typ := "group"
				if f.Which() == schema.Field_Which_slot {
					t, err := f.Slot().Type()
					if err != nil {
						return result, err
					}
					typ, err = s.typeName(t, 0)
					if err != nil {
						return result, err
					}
				}
				item.Fields = append(item.Fields, Field{Name: label, Type: typ, Union: f.DiscriminantValue() != schema.Field_noDiscriminant})
			}
			result.Methods = append(result.Methods, item)
		}
	}
	sort.Slice(result.Methods, func(i, j int) bool {
		a, b := result.Methods[i], result.Methods[j]
		if a.InterfaceName != b.InterfaceName {
			return a.InterfaceName < b.InterfaceName
		}
		return a.Ordinal < b.Ordinal
	})
	return result, nil
}

func (s *Schema) method(id string, ordinal uint16) (schema.Method, uint64, error) {
	id64, err := strconv.ParseUint(id, 0, 64)
	n, ok := s.nodes[id64]
	if err != nil || !ok || n.Which() != schema.Node_Which_interface || n.IsGeneric() {
		return schema.Method{}, 0, errors.New("choose a concrete interface from this schema")
	}
	methods, err := n.Interface().Methods()
	if err != nil || int(ordinal) >= methods.Len() {
		return schema.Method{}, 0, errors.New("method is not in the selected interface")
	}
	method := methods.At(int(ordinal))
	implicit, err := method.ImplicitParameters()
	if err != nil || implicit.Len() != 0 {
		return schema.Method{}, 0, errors.New("generic method parameters are not supported by this workbench")
	}
	return method, id64, nil
}

// Used by compiler and wire output writers; composition prevents io.Copy from
// discovering bytes.Buffer.ReadFrom and bypassing the bound.
type boundedBuffer struct {
	data bytes.Buffer
	max  int
}

func (b *boundedBuffer) Write(p []byte) (int, error) {
	if len(p) > b.max-b.data.Len() {
		return 0, errors.New("the Cap'n Proto output exceeds its size limit")
	}
	return b.data.Write(p)
}

var _ io.Writer = (*boundedBuffer)(nil)
