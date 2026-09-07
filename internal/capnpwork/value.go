package capnpwork

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"

	"capnproto.org/go/capnp/v3"
	"capnproto.org/go/capnp/v3/std/capnp/schema"
)

func defaultBits(t schema.Type_Which, d schema.Value) uint64 {
	if !d.IsValid() {
		return 0
	}
	switch t {
	case schema.Type_Which_bool:
		if d.Bool() {
			return 1
		}
		return 0
	case schema.Type_Which_int8:
		return uint64(uint8(d.Int8()))
	case schema.Type_Which_int16:
		return uint64(uint16(d.Int16()))
	case schema.Type_Which_int32:
		return uint64(uint32(d.Int32()))
	case schema.Type_Which_int64:
		return uint64(d.Int64())
	case schema.Type_Which_uint8:
		return uint64(d.Uint8())
	case schema.Type_Which_uint16:
		return uint64(d.Uint16())
	case schema.Type_Which_uint32:
		return uint64(d.Uint32())
	case schema.Type_Which_uint64:
		return d.Uint64()
	case schema.Type_Which_float32:
		return uint64(math.Float32bits(d.Float32()))
	case schema.Type_Which_float64:
		return math.Float64bits(d.Float64())
	case schema.Type_Which_enum:
		return uint64(d.Enum())
	default:
		return 0
	}
}

func numericText(value any) (string, error) {
	switch value := value.(type) {
	case json.Number:
		return value.String(), nil
	case string:
		return value, nil
	default:
		return "", errors.New("expected a number or exact numeric string")
	}
}

func (s *Schema) scalarBits(t schema.Type, value any) (uint64, error) {
	kind := t.Which()
	if kind == schema.Type_Which_void {
		if value != nil {
			return 0, errors.New("void uses null")
		}
		return 0, nil
	}
	if kind == schema.Type_Which_bool {
		v, ok := value.(bool)
		if !ok {
			return 0, errors.New("expected boolean")
		}
		if v {
			return 1, nil
		}
		return 0, nil
	}
	if kind == schema.Type_Which_enum {
		label, ok := value.(string)
		if ok {
			n := s.nodes[t.Enum().TypeId()]
			values, err := n.Enum().Enumerants()
			if err != nil {
				return 0, err
			}
			for i := 0; i < values.Len(); i++ {
				name, _ := values.At(i).Name()
				if name == label {
					return uint64(i), nil
				}
			}
		}
	}
	raw, err := numericText(value)
	if err != nil {
		return 0, err
	}
	bits := typeBits(kind)
	switch {
	case kind >= schema.Type_Which_int8 && kind <= schema.Type_Which_int64:
		v, err := strconv.ParseInt(raw, 10, bits)
		return uint64(v), err
	case kind >= schema.Type_Which_uint8 && kind <= schema.Type_Which_uint64 || kind == schema.Type_Which_enum:
		return strconv.ParseUint(raw, 10, bits)
	case kind == schema.Type_Which_float32 || kind == schema.Type_Which_float64:
		v, err := strconv.ParseFloat(raw, bits)
		if bits == 32 {
			return uint64(math.Float32bits(float32(v))), err
		}
		return math.Float64bits(v), err
	default:
		return 0, errors.New("not a scalar field")
	}
}

func writeBits(st capnp.Struct, offset uint32, bits int, value uint64) {
	switch bits {
	case 1:
		st.SetBit(capnp.BitOffset(offset), value != 0)
	case 8:
		st.SetUint8(capnp.DataOffset(offset), uint8(value))
	case 16:
		st.SetUint16(capnp.DataOffset(offset*2), uint16(value))
	case 32:
		st.SetUint32(capnp.DataOffset(offset*4), uint32(value))
	case 64:
		st.SetUint64(capnp.DataOffset(offset*8), value)
	}
}

func readBits(st capnp.Struct, offset uint32, bits int) uint64 {
	switch bits {
	case 1:
		if st.Bit(capnp.BitOffset(offset)) {
			return 1
		}
	case 8:
		return uint64(st.Uint8(capnp.DataOffset(offset)))
	case 16:
		return uint64(st.Uint16(capnp.DataOffset(offset * 2)))
	case 32:
		return uint64(st.Uint32(capnp.DataOffset(offset * 4)))
	case 64:
		return st.Uint64(capnp.DataOffset(offset * 8))
	}
	return 0
}

func jsonFloat(value float64) any {
	if math.IsNaN(value) {
		return "NaN"
	}
	if math.IsInf(value, 1) {
		return "Infinity"
	}
	if math.IsInf(value, -1) {
		return "-Infinity"
	}
	return value
}

func (s *Schema) scalarJSON(t schema.Type, bits uint64) (any, error) {
	switch t.Which() {
	case schema.Type_Which_void:
		return nil, nil
	case schema.Type_Which_bool:
		return bits != 0, nil
	case schema.Type_Which_int8:
		return int8(bits), nil
	case schema.Type_Which_int16:
		return int16(bits), nil
	case schema.Type_Which_int32:
		return int32(bits), nil
	case schema.Type_Which_int64:
		return strconv.FormatInt(int64(bits), 10), nil
	case schema.Type_Which_uint8:
		return uint8(bits), nil
	case schema.Type_Which_uint16:
		return uint16(bits), nil
	case schema.Type_Which_uint32:
		return uint32(bits), nil
	case schema.Type_Which_uint64:
		return strconv.FormatUint(bits, 10), nil
	case schema.Type_Which_float32:
		return jsonFloat(float64(math.Float32frombits(uint32(bits)))), nil
	case schema.Type_Which_float64:
		return jsonFloat(math.Float64frombits(bits)), nil
	case schema.Type_Which_enum:
		n, ok := s.nodes[t.Enum().TypeId()]
		if !ok {
			return nil, errors.New("missing enum schema")
		}
		values, err := n.Enum().Enumerants()
		if err != nil {
			return nil, err
		}
		if bits >= uint64(values.Len()) {
			return bits, nil
		} // Unknown newer enum value remains numeric.
		return values.At(int(bits)).Name()
	default:
		return nil, fmt.Errorf("unsupported scalar %s", t.Which())
	}
}
