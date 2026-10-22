package capnpwork

import (
	"errors"
	"fmt"
	"strconv"
	"strings"

	"capnproto.org/go/capnp/v3"
	"capnproto.org/go/capnp/v3/std/capnp/schema"
)

// Bindings are local interpretations of pointer types. No schema node is mutated,
// and each resolved reference retains the environment in which it was declared.
type boundType struct {
	typ   schema.Type
	owner *Schema
}
type typeEnvironment map[uint64][]boundType

type TypeParameter struct {
	ScopeID string `json:"scopeId"`
	Index   int    `json:"index"`
	Name    string `json:"name"`
}

func (s *Schema) resolveType(typ schema.Type) (*Schema, schema.Type, error) {
	for depth := 0; depth <= maxDepth; depth++ {
		if typ.Which() != schema.Type_Which_anyPointer {
			return s, typ, nil
		}
		if typ.AnyPointer().Which() == schema.Type_anyPointer_Which_implicitMethodParameter {
			index := int(typ.AnyPointer().ImplicitMethodParameter().ParameterIndex())
			if index >= len(s.implicit) || s.implicit[index].owner == nil {
				return nil, schema.Type{}, errors.New("generic method parameter binding is missing")
			}
			bound := s.implicit[index]
			s, typ = bound.owner, bound.typ
			continue
		}
		if typ.AnyPointer().Which() != schema.Type_anyPointer_Which_parameter {
			return s, typ, nil
		}
		parameter := typ.AnyPointer().Parameter()
		node, ok := s.nodes[parameter.ScopeId()]
		if !ok {
			return nil, schema.Type{}, errors.New("generic parameter references a missing scope")
		}
		parameters, err := node.Parameters()
		if err != nil || int(parameter.ParameterIndex()) >= parameters.Len() {
			return nil, schema.Type{}, errors.New("generic parameter index is outside its scope")
		}
		values := s.bindings[parameter.ScopeId()]
		if int(parameter.ParameterIndex()) >= len(values) || values[parameter.ParameterIndex()].owner == nil {
			return s, typ, nil
		}
		bound := values[parameter.ParameterIndex()]
		s, typ = bound.owner, bound.typ
	}
	return nil, schema.Type{}, errors.New("generic parameter substitution exceeds 16 levels or contains a cycle")
}

func (s *Schema) withBrand(brand schema.Brand, target uint64) (*Schema, error) {
	bindings := make(typeEnvironment, len(s.bindings)+4)
	for id, values := range s.bindings {
		bindings[id] = values
	}
	seen := map[uint64]bool{}
	for id := target; id != 0; {
		if seen[id] || len(seen) > maxDepth {
			return nil, errors.New("generic lexical scopes contain a cycle or exceed 16 levels")
		}
		seen[id] = true
		node, ok := s.nodes[id]
		if !ok {
			return nil, errors.New("generic target scope is missing")
		}
		delete(bindings, id) // Omitted relevant scopes are AnyPointer, not implicit inheritance.
		id = node.ScopeId()
	}
	scopes, err := brand.Scopes()
	if err != nil || scopes.Len() > 64 {
		return nil, errors.New("generic brand exceeds 64 scopes")
	}
	applied := map[uint64]bool{}
	for index := 0; index < scopes.Len(); index++ {
		scope := scopes.At(index)
		id := scope.ScopeId()
		node, ok := s.nodes[id]
		if !ok || applied[id] {
			return nil, errors.New("generic brand contains a missing or duplicate scope")
		}
		applied[id] = true
		parameters, e := node.Parameters()
		if e != nil || parameters.Len() > 64 {
			return nil, errors.New("generic scope exceeds 64 parameters")
		}
		if scope.Which() == schema.Brand_Scope_Which_inherit {
			bindings[id] = s.bindings[id]
			continue
		}
		values, e := scope.Bind()
		if e != nil || values.Len() > parameters.Len() {
			return nil, errors.New("generic brand has too many bindings")
		}
		resolved := make([]boundType, parameters.Len())
		for n := 0; n < values.Len(); n++ {
			value := values.At(n)
			if value.Which() == schema.Brand_Binding_Which_unbound {
				continue
			}
			typ, e := value.Type()
			if e != nil {
				return nil, e
			}
			if !pointerBinding(typ) {
				return nil, errors.New("generic bindings must use pointer types")
			}
			owner, typ, e := s.resolveType(typ)
			if e != nil {
				return nil, e
			}
			resolved[n] = boundType{typ, owner}
		}
		bindings[id] = resolved
	}
	return &Schema{message: s.message, nodes: s.nodes, bindings: bindings, implicit: s.implicit}, nil
}

func pointerBinding(typ schema.Type) bool {
	switch typ.Which() {
	case schema.Type_Which_text, schema.Type_Which_data, schema.Type_Which_list, schema.Type_Which_structType, schema.Type_Which_interface, schema.Type_Which_anyPointer:
		return true
	default:
		return false
	}
}

func (s *Schema) typeParameters(id uint64) ([]TypeParameter, error) {
	result := []TypeParameter{}
	seen := map[uint64]bool{}
	for id != 0 {
		if seen[id] || len(seen) > maxDepth {
			return nil, errors.New("generic scope chain is invalid")
		}
		seen[id] = true
		node, ok := s.nodes[id]
		if !ok {
			return nil, errors.New("generic scope is missing")
		}
		parameters, err := node.Parameters()
		if err != nil || parameters.Len() > 64 {
			return nil, errors.New("generic parameter list is invalid")
		}
		for i := 0; i < parameters.Len(); i++ {
			name, err := parameters.At(i).Name()
			if err != nil || !safeLabel(name, 128) {
				return nil, errors.New("generic parameter name is invalid")
			}
			result = append(result, TypeParameter{fmt.Sprintf("0x%x", id), i, name})
		}
		id = node.ScopeId()
	}
	if len(result) > 64 {
		return nil, errors.New("interface exceeds 64 generic parameters")
	}
	return result, nil
}

type typeArena struct {
	message *capnp.Message
	segment *capnp.Segment
	count   int
}

func newTypeArena() *typeArena {
	message, segment := capnp.NewSingleSegmentMessage(nil)
	return &typeArena{message: message, segment: segment}
}

// Type arguments use Text, Data, AnyPointer, List(T), or a schema node ID,
// optionally followed by that node's own arguments: 0xabc(Text).
func (s *Schema) parseTypeArgument(arena *typeArena, text string, depth int) (schema.Type, error) {
	return s.parseTypeExpression(arena, text, depth, false)
}

func (s *Schema) parseTypeExpression(arena *typeArena, text string, depth int, allowScalar bool) (schema.Type, error) {
	arena.count++
	if depth > maxDepth || arena.count > 256 || len(text) > 512 {
		return schema.Type{}, errors.New("type bindings exceed their nesting, count or text limit")
	}
	text = strings.TrimSpace(text)
	typ, err := schema.NewType(arena.segment)
	if err != nil {
		return typ, err
	}
	if allowScalar {
		switch text {
		case "Void":
			typ.SetVoid()
			return typ, nil
		case "Bool":
			typ.SetBool()
			return typ, nil
		case "Int8":
			typ.SetInt8()
			return typ, nil
		case "Int16":
			typ.SetInt16()
			return typ, nil
		case "Int32":
			typ.SetInt32()
			return typ, nil
		case "Int64":
			typ.SetInt64()
			return typ, nil
		case "UInt8":
			typ.SetUint8()
			return typ, nil
		case "UInt16":
			typ.SetUint16()
			return typ, nil
		case "UInt32":
			typ.SetUint32()
			return typ, nil
		case "UInt64":
			typ.SetUint64()
			return typ, nil
		case "Float32":
			typ.SetFloat32()
			return typ, nil
		case "Float64":
			typ.SetFloat64()
			return typ, nil
		}
	}
	switch text {
	case "Text":
		typ.SetText()
		return typ, nil
	case "Data":
		typ.SetData()
		return typ, nil
	case "AnyPointer":
		typ.SetAnyPointer()
		typ.AnyPointer().SetUnconstrained()
		typ.AnyPointer().Unconstrained().SetAnyKind()
		return typ, nil
	}
	if strings.HasPrefix(text, "List(") && strings.HasSuffix(text, ")") {
		element, err := s.parseTypeExpression(arena, text[5:len(text)-1], depth+1, true)
		if err != nil {
			return typ, err
		}
		typ.SetList()
		return typ, typ.List().SetElementType(element)
	}
	idText := text
	arguments := ""
	hasArguments := false
	if index := strings.IndexByte(text, '('); index >= 0 {
		if !strings.HasSuffix(text, ")") {
			return typ, errors.New("type binding has unbalanced parentheses")
		}
		idText, arguments, hasArguments = text[:index], text[index+1:len(text)-1], true
	}
	id, err := strconv.ParseUint(idText, 0, 64)
	node, ok := s.nodes[id]
	if err != nil || !ok || (node.Which() != schema.Node_Which_structNode && node.Which() != schema.Node_Which_interface && !(allowScalar && node.Which() == schema.Node_Which_enum)) {
		return typ, errors.New("type argument must be Text, Data, List(T), AnyPointer or a struct/interface schema ID")
	}
	if node.Which() == schema.Node_Which_enum {
		if hasArguments {
			return typ, errors.New("enum types cannot have arguments")
		}
		typ.SetEnum()
		typ.Enum().SetTypeId(id)
		return typ, nil
	}
	var brand schema.Brand
	if node.Which() == schema.Node_Which_structNode {
		typ.SetStructType()
		typ.StructType().SetTypeId(id)
		brand, err = typ.StructType().NewBrand()
	} else {
		typ.SetInterface()
		typ.Interface().SetTypeId(id)
		brand, err = typ.Interface().NewBrand()
	}
	if err != nil {
		return typ, err
	}
	if !hasArguments {
		return typ, nil
	}
	parameters, err := node.Parameters()
	if err != nil {
		return typ, err
	}
	parts := []string{}
	start, nesting := 0, 0
	for i, c := range arguments {
		switch c {
		case '(':
			nesting++
		case ')':
			nesting--
			if nesting < 0 {
				return typ, errors.New("type binding parentheses are invalid")
			}
		case ',':
			if nesting == 0 {
				parts = append(parts, arguments[start:i])
				start = i + 1
			}
		}
	}
	if len(arguments) > 0 {
		parts = append(parts, arguments[start:])
	}
	if nesting != 0 || len(parts) != parameters.Len() || len(parts) > 64 {
		return typ, errors.New("type binding argument count does not match the schema")
	}
	scopes, err := brand.NewScopes(1)
	if err != nil {
		return typ, err
	}
	scopes.At(0).SetScopeId(id)
	values, err := scopes.At(0).NewBind(int32(len(parts)))
	if err != nil {
		return typ, err
	}
	for i, part := range parts {
		value, err := s.parseTypeArgument(arena, part, depth+1)
		if err != nil {
			return typ, err
		}
		if err := values.At(i).SetType(value); err != nil {
			return typ, err
		}
	}
	return typ, nil
}

func (s *Schema) withUserBindings(bindings map[string][]string, arena *typeArena) (*Schema, error) {
	if len(bindings) > 64 {
		return nil, errors.New("type bindings exceed 64 scopes")
	}
	next := &Schema{message: s.message, nodes: s.nodes, bindings: make(typeEnvironment, len(s.bindings)+len(bindings)), implicit: s.implicit}
	for id, values := range s.bindings {
		next.bindings[id] = values
	}
	seen := make(map[uint64]bool, len(bindings))
	for raw, arguments := range bindings {
		id, err := strconv.ParseUint(raw, 0, 64)
		node, ok := s.nodes[id]
		if err != nil || !ok || seen[id] {
			return nil, errors.New("type binding scope is missing from the schema")
		}
		seen[id] = true
		parameters, err := node.Parameters()
		if err != nil || len(arguments) != parameters.Len() || len(arguments) > 64 {
			return nil, errors.New("type binding count does not match its scope")
		}
		values := make([]boundType, len(arguments))
		for i, argument := range arguments {
			typ, err := s.parseTypeArgument(arena, argument, 0)
			if err != nil {
				return nil, err
			}
			values[i] = boundType{typ, s}
		}
		next.bindings[id] = values
	}
	return next, nil
}

func (s *Schema) methodSchemas(method schema.Method, arguments []string, arena *typeArena) (*Schema, *Schema, error) {
	parameters, err := method.ImplicitParameters()
	if err != nil || len(arguments) != parameters.Len() || len(arguments) > 64 {
		return nil, nil, errors.New("bind every implicit method type parameter explicitly")
	}
	implicit := make([]boundType, len(arguments))
	for i, text := range arguments {
		typ, err := s.parseTypeArgument(arena, text, 0)
		if err != nil {
			return nil, nil, err
		}
		implicit[i] = boundType{typ, s}
	}
	paramBrand, err := method.ParamBrand()
	if err != nil {
		return nil, nil, err
	}
	resultBrand, err := method.ResultBrand()
	if err != nil {
		return nil, nil, err
	}
	// Method parameters can also occur inside a brand's List or nested struct
	// expression, so retain their environment until the codec reaches that type.
	caller := &Schema{message: s.message, nodes: s.nodes, bindings: s.bindings, implicit: implicit}
	params, err := caller.withBrand(paramBrand, method.ParamStructType())
	if err != nil {
		return nil, nil, err
	}
	results, err := caller.withBrand(resultBrand, method.ResultStructType())
	return params, results, err
}

func (s *Schema) structContext(typ schema.Type) (*Schema, schema.Node, error) {
	node, err := s.structNode(typ.StructType().TypeId())
	if err != nil {
		return nil, node, err
	}
	brand, err := typ.StructType().Brand()
	if err != nil {
		return nil, node, err
	}
	child, err := s.withBrand(brand, node.Id())
	return child, node, err
}

func (s *Schema) listElement(typ schema.Type) (*Schema, schema.Type, error) {
	element, err := typ.List().ElementType()
	if err != nil {
		return nil, schema.Type{}, err
	}
	child, element, err := s.resolveType(element)
	if err != nil {
		return nil, element, err
	}
	if element.Which() == schema.Type_Which_structType {
		context, _, err := child.structContext(element)
		return context, element, err
	}
	return child, element, nil
}
