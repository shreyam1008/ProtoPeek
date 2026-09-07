package capnpwork

import (
	"errors"
	"fmt"

	"capnproto.org/go/capnp/v3"
	"capnproto.org/go/capnp/v3/std/capnp/schema"
)

func (s *Schema) encodeList(seg *capnp.Segment, typ schema.Type, value any, depth int, budget *codecBudget) (capnp.Ptr, error) {
	items, ok := value.([]any)
	if !ok || len(items) > 4096 {
		return capnp.Ptr{}, errors.New("list must be an array of at most 4096 values")
	}
	t, err := typ.List().ElementType()
	if err != nil {
		return capnp.Ptr{}, err
	}
	bits := typeBits(t.Which())
	if err := budget.take(depth, len(items)*max(8, bits/8)); err != nil {
		return capnp.Ptr{}, err
	}
	n := int32(len(items))
	var list capnp.List
	switch {
	case t.Which() == schema.Type_Which_structType:
		node, e := s.structNode(t.StructType().TypeId())
		if e != nil {
			return capnp.Ptr{}, e
		}
		size := objectSize(node)
		if err := budget.take(depth, len(items)*(int(size.DataSize)+int(size.PointerCount)*8)); err != nil {
			return capnp.Ptr{}, err
		}
		list, err = capnp.NewCompositeList(seg, size, n)
	case bits == 0:
		list = capnp.List(capnp.NewVoidList(seg, n))
	case bits == 1:
		values, err := capnp.NewBitList(seg, n)
		if err != nil {
			return capnp.Ptr{}, err
		}
		for i, v := range items {
			b, ok := v.(bool)
			if !ok {
				return capnp.Ptr{}, fmt.Errorf("list[%d]: expected boolean", i)
			}
			values.Set(i, b)
		}
		return values.ToPtr(), nil
	case bits == 8:
		var v capnp.UInt8List
		v, err = capnp.NewUInt8List(seg, n)
		list = capnp.List(v)
	case bits == 16:
		var v capnp.UInt16List
		v, err = capnp.NewUInt16List(seg, n)
		list = capnp.List(v)
	case bits == 32:
		var v capnp.UInt32List
		v, err = capnp.NewUInt32List(seg, n)
		list = capnp.List(v)
	case bits == 64:
		var v capnp.UInt64List
		v, err = capnp.NewUInt64List(seg, n)
		list = capnp.List(v)
	default:
		var v capnp.PointerList
		v, err = capnp.NewPointerList(seg, n)
		list = capnp.List(v)
	}
	if err != nil {
		return capnp.Ptr{}, err
	}
	for i, v := range items {
		if t.Which() == schema.Type_Which_structType {
			node, _ := s.structNode(t.StructType().TypeId())
			err = s.encodeStruct(node, list.Struct(i), v, depth+1, budget)
		} else {
			err = s.encodeField(list.Struct(i), 0, t, schema.Value{}, v, depth+1, budget)
		}
		if err != nil {
			return capnp.Ptr{}, fmt.Errorf("list[%d]: %w", i, err)
		}
	}
	return list.ToPtr(), nil
}

func (s *Schema) decodeList(p capnp.Ptr, typ schema.Type, depth int, budget *codecBudget) ([]any, error) {
	list := p.List()
	if !list.IsValid() || list.Len() > 4096 {
		return nil, errors.New("invalid list or more than 4096 values")
	}
	if err := budget.take(depth, list.Len()*16); err != nil {
		return nil, err
	}
	t, err := typ.List().ElementType()
	if err != nil {
		return nil, err
	}
	items := make([]any, list.Len())
	for i := range items {
		switch t.Which() {
		case schema.Type_Which_bool:
			items[i] = capnp.BitList(list).At(i)
		case schema.Type_Which_structType:
			node, e := s.structNode(t.StructType().TypeId())
			if e != nil {
				return nil, e
			}
			items[i], err = s.decodeStruct(node, list.Struct(i), depth+1, budget)
		default:
			items[i], err = s.decodeField(list.Struct(i), 0, t, schema.Value{}, depth+1, budget)
		}
		if err != nil {
			return nil, fmt.Errorf("list[%d]: %w", i, err)
		}
	}
	return items, nil
}
