package capnpwork

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"unicode/utf8"

	"capnproto.org/go/capnp/v3"
	"capnproto.org/go/capnp/v3/std/capnp/schema"
)

type codecBudget struct{ steps, bytes int }

func (b *codecBudget) take(depth, size int) error {
	b.steps++
	b.bytes += size
	if depth > maxDepth || b.steps > 32768 || b.bytes > 2<<20 {
		return errors.New("message exceeds the workbench nesting, value count or allocation limit")
	}
	return nil
}

func (s *Schema) EncodeParams(typeID uint64, raw json.RawMessage) (*capnp.Message, capnp.Struct, error) {
	if len(raw) == 0 || len(raw) > MaxBodyBytes {
		return nil, capnp.Struct{}, errors.New("request JSON must be between 1 byte and 64 KiB")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	var value any
	if err := d.Decode(&value); err != nil {
		return nil, capnp.Struct{}, err
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return nil, capnp.Struct{}, errors.New("request must contain one JSON object")
	}
	n, err := s.structNode(typeID)
	if err != nil {
		return nil, capnp.Struct{}, err
	}
	msg, seg := capnp.NewSingleSegmentMessage(nil)
	st, err := capnp.NewRootStruct(seg, objectSize(n))
	if err == nil {
		err = s.encodeStruct(n, st, value, 0, &codecBudget{})
	}
	if err != nil {
		msg.Release()
		return nil, capnp.Struct{}, err
	}
	return msg, st, nil
}

func (s *Schema) encodeStruct(n schema.Node, st capnp.Struct, value any, depth int, budget *codecBudget) error {
	if err := budget.take(depth, int(objectSize(n).DataSize)+int(objectSize(n).PointerCount)*8); err != nil {
		return err
	}
	object, ok := value.(map[string]any)
	if !ok {
		return errors.New("struct parameters require a JSON object")
	}
	fields, err := n.StructNode().Fields()
	if err != nil {
		return err
	}
	known := make(map[string]schema.Field, fields.Len())
	for i := 0; i < fields.Len(); i++ {
		f := fields.At(i)
		name, _ := f.Name()
		known[name] = f
	}
	unionSet := false
	for name, v := range object {
		f, ok := known[name]
		if !ok {
			return fmt.Errorf("unknown field %q", name)
		}
		if dv := f.DiscriminantValue(); dv != schema.Field_noDiscriminant {
			if unionSet {
				return errors.New("set only one field from an anonymous union")
			}
			unionSet = true
			st.SetUint16(capnp.DataOffset(n.StructNode().DiscriminantOffset()*2), dv)
		}
		if f.Which() == schema.Field_Which_group {
			group, err := s.structNode(f.Group().TypeId())
			if err != nil {
				return err
			}
			if err := s.encodeStruct(group, st, v, depth+1, budget); err != nil {
				return fmt.Errorf("%s: %w", name, err)
			}
			continue
		}
		t, err := f.Slot().Type()
		if err != nil {
			return err
		}
		d, err := f.Slot().DefaultValue()
		if err != nil {
			return err
		}
		if err := s.encodeField(st, f.Slot().Offset(), t, d, v, depth+1, budget); err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
	}
	return nil
}

func (s *Schema) encodeField(st capnp.Struct, offset uint32, t schema.Type, d schema.Value, value any, depth int, budget *codecBudget) error {
	if err := budget.take(depth, 0); err != nil {
		return err
	}
	if bits := typeBits(t.Which()); bits >= 0 {
		valueBits, err := s.scalarBits(t, value)
		if err != nil {
			return err
		}
		writeBits(st, offset, bits, valueBits^defaultBits(t.Which(), d))
		return nil
	}
	p, err := s.encodePointer(st.Segment(), t, value, depth, budget)
	if err != nil {
		return err
	}
	return st.SetPtr(uint16(offset), p)
}

func (s *Schema) encodePointer(seg *capnp.Segment, t schema.Type, value any, depth int, budget *codecBudget) (capnp.Ptr, error) {
	if value == nil {
		return capnp.Ptr{}, nil
	}
	switch t.Which() {
	case schema.Type_Which_text, schema.Type_Which_data:
		text, ok := value.(string)
		if !ok || !utf8.ValidString(text) {
			return capnp.Ptr{}, errors.New("text requires a string; Data requires a base64 string")
		}
		if err := budget.take(depth, len(text)+8); err != nil {
			return capnp.Ptr{}, err
		}
		if t.Which() == schema.Type_Which_text {
			p, err := capnp.NewText(seg, text)
			return p.ToPtr(), err
		}
		data, err := base64.StdEncoding.Strict().DecodeString(text)
		if err != nil {
			return capnp.Ptr{}, errors.New("data must be padded standard base64")
		}
		p, err := capnp.NewData(seg, data)
		return p.ToPtr(), err
	case schema.Type_Which_structType:
		n, err := s.structNode(t.StructType().TypeId())
		if err != nil {
			return capnp.Ptr{}, err
		}
		st, err := capnp.NewStruct(seg, objectSize(n))
		if err != nil {
			return capnp.Ptr{}, err
		}
		if err := s.encodeStruct(n, st, value, depth+1, budget); err != nil {
			return capnp.Ptr{}, err
		}
		return st.ToPtr(), nil
	case schema.Type_Which_list:
		return s.encodeList(seg, t, value, depth+1, budget)
	case schema.Type_Which_interface, schema.Type_Which_anyPointer:
		return capnp.Ptr{}, errors.New("capability and AnyPointer inputs currently support null only")
	default:
		return capnp.Ptr{}, errors.New("unknown pointer type")
	}
}

func (s *Schema) DecodeResults(typeID uint64, st capnp.Struct) (json.RawMessage, error) {
	n, err := s.structNode(typeID)
	if err != nil {
		return nil, err
	}
	value, err := s.decodeStruct(n, st, 0, &codecBudget{})
	if err != nil {
		return nil, err
	}
	b := &boundedBuffer{max: MaxBodyBytes}
	if err := json.NewEncoder(b).Encode(value); err != nil {
		return nil, err
	}
	return append(json.RawMessage(nil), b.data.Bytes()...), nil
}

func (s *Schema) decodeStruct(n schema.Node, st capnp.Struct, depth int, budget *codecBudget) (map[string]any, error) {
	if err := budget.take(depth, 16); err != nil {
		return nil, err
	}
	fields, err := n.StructNode().Fields()
	if err != nil {
		return nil, err
	}
	result := make(map[string]any)
	discriminant := st.Uint16(capnp.DataOffset(n.StructNode().DiscriminantOffset() * 2))
	if count := n.StructNode().DiscriminantCount(); count > 0 && discriminant >= count {
		return nil, fmt.Errorf("unknown union discriminant %d", discriminant)
	}
	for i := 0; i < fields.Len(); i++ {
		f := fields.At(i)
		if dv := f.DiscriminantValue(); dv != schema.Field_noDiscriminant && dv != discriminant {
			continue
		}
		name, _ := f.Name()
		if f.Which() == schema.Field_Which_group {
			group, err := s.structNode(f.Group().TypeId())
			if err != nil {
				return nil, err
			}
			result[name], err = s.decodeStruct(group, st, depth+1, budget)
			if err != nil {
				return nil, err
			}
			continue
		}
		t, err := f.Slot().Type()
		if err != nil {
			return nil, err
		}
		d, err := f.Slot().DefaultValue()
		if err != nil {
			return nil, err
		}
		result[name], err = s.decodeField(st, f.Slot().Offset(), t, d, depth+1, budget)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", name, err)
		}
	}
	return result, nil
}

func (s *Schema) decodeField(st capnp.Struct, offset uint32, t schema.Type, d schema.Value, depth int, budget *codecBudget) (any, error) {
	if err := budget.take(depth, 16); err != nil {
		return nil, err
	}
	if bits := typeBits(t.Which()); bits >= 0 {
		return s.scalarJSON(t, readBits(st, offset, bits)^defaultBits(t.Which(), d))
	}
	p, err := st.Ptr(uint16(offset))
	if err != nil {
		return nil, err
	}
	if !p.IsValid() && d.IsValid() {
		p, err = capnp.Struct(d).Ptr(0)
		if err != nil {
			return nil, err
		}
	}
	return s.decodePointer(p, t, depth, budget)
}

func (s *Schema) decodePointer(p capnp.Ptr, t schema.Type, depth int, budget *codecBudget) (any, error) {
	if !p.IsValid() {
		switch t.Which() {
		case schema.Type_Which_text, schema.Type_Which_data:
			return "", nil
		case schema.Type_Which_list:
			return []any{}, nil
		default:
			return nil, nil
		}
	}
	switch t.Which() {
	case schema.Type_Which_text:
		data := p.TextBytes()
		if data == nil || !utf8.Valid(data) {
			return nil, errors.New("invalid Text pointer")
		}
		if err := budget.take(depth, len(data)); err != nil {
			return nil, err
		}
		return string(data), nil
	case schema.Type_Which_data:
		data := p.Data()
		if data == nil {
			return nil, errors.New("invalid Data pointer")
		}
		if err := budget.take(depth, base64.StdEncoding.EncodedLen(len(data))); err != nil {
			return nil, err
		}
		return base64.StdEncoding.EncodeToString(data), nil
	case schema.Type_Which_structType:
		if !p.Struct().IsValid() {
			return nil, errors.New("invalid struct pointer")
		}
		n, err := s.structNode(t.StructType().TypeId())
		if err != nil {
			return nil, err
		}
		return s.decodeStruct(n, p.Struct(), depth+1, budget)
	case schema.Type_Which_list:
		return s.decodeList(p, t, depth+1, budget)
	case schema.Type_Which_interface:
		if !p.Interface().IsValid() {
			return nil, errors.New("invalid capability pointer")
		}
		return map[string]any{"$capability": "returned capability; invocation is not exposed by this workbench"}, nil
	case schema.Type_Which_anyPointer:
		return map[string]any{"$anyPointer": "opaque value; schema cannot describe its contents"}, nil
	default:
		return nil, errors.New("unknown pointer type")
	}
}
