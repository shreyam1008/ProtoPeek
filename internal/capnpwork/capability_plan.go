package capnpwork

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"

	"capnproto.org/go/capnp/v3"
	"capnproto.org/go/capnp/v3/std/capnp/schema"
)

const MaxPlanSteps = 8

type CapabilityTarget struct {
	Step int      `json:"step"`
	Path []string `json:"path"`
}
type CallStep struct {
	InterfaceID  string              `json:"interfaceId"`
	Ordinal      uint16              `json:"ordinal"`
	Params       json.RawMessage     `json:"params"`
	Target       *CapabilityTarget   `json:"target,omitempty"`
	TypeBindings map[string][]string `json:"typeBindings,omitempty"`
	MethodTypes  []string            `json:"methodTypes,omitempty"`
}
type PlanStepResult struct {
	Step        int             `json:"step"`
	InterfaceID string          `json:"interfaceId"`
	Ordinal     uint16          `json:"ordinal"`
	Result      json.RawMessage `json:"result"`
	Error       string          `json:"error,omitempty"`
}
type PlanResult struct {
	SentSteps int              `json:"sentSteps"`
	Completed bool             `json:"completed"`
	Steps     []PlanStepResult `json:"steps"`
}
type CapabilityPath struct {
	Path        []string `json:"path"`
	InterfaceID string   `json:"interfaceId"`
}
type preparedCall struct {
	method      schema.Method
	interfaceID uint64
	input       CallStep
	arguments   *capnp.Message
	args        capnp.Struct
	results     *Schema
	parent      int
	offsets     []uint16
}
type preparedPlan struct {
	calls  []preparedCall
	arena  *typeArena
	isPlan bool
}

func (plan *preparedPlan) close() {
	for _, call := range plan.calls {
		call.arguments.Release()
	}
	plan.arena.message.Release()
}

func (s *Schema) preparePlan(input CallRequest) (*preparedPlan, error) {
	plan := &preparedPlan{arena: newTypeArena(), isPlan: len(input.Steps) > 0}
	fail := func(err error) (*preparedPlan, error) { plan.close(); return nil, err }
	steps := input.Steps
	if len(steps) > MaxPlanSteps {
		return fail(errors.New("call plans accept at most eight steps"))
	}
	if plan.isPlan {
		legacyParams := bytes.TrimSpace(input.Params)
		if input.InterfaceID != "" || input.Ordinal != 0 || (len(legacyParams) > 0 && !bytes.Equal(legacyParams, []byte("null"))) || len(input.TypeBindings) > 0 || len(input.MethodTypes) > 0 {
			return fail(errors.New("choose a single call or a call plan, without mixing their fields"))
		}
	} else {
		steps = []CallStep{{InterfaceID: input.InterfaceID, Ordinal: input.Ordinal, Params: input.Params, TypeBindings: input.TypeBindings, MethodTypes: input.MethodTypes}}
	}
	for index, step := range steps {
		context := s
		parent := -1
		var offsets []uint16
		if step.Target != nil {
			parent = step.Target.Step
			if parent < 0 || parent >= index {
				return fail(fmt.Errorf("step %d must reference an earlier step", index+1))
			}
			prior := plan.calls[parent]
			var targetID uint64
			var err error
			context, targetID, offsets, err = prior.results.capabilityAt(prior.method.ResultStructType(), step.Target.Path)
			if err != nil {
				return fail(fmt.Errorf("step %d capability: %w", index+1, err))
			}
			if step.InterfaceID == "" {
				step.InterfaceID = fmt.Sprintf("0x%x", targetID)
			}
			requestedID, parseErr := strconv.ParseUint(step.InterfaceID, 0, 64)
			if parseErr != nil || requestedID != targetID {
				return fail(fmt.Errorf("step %d must use the interface declared by its returned capability", index+1))
			}
		}
		if parent >= 0 {
			for raw := range step.TypeBindings {
				id, _ := strconv.ParseUint(raw, 0, 64)
				for _, binding := range context.bindings[id] {
					if binding.owner != nil {
						return fail(fmt.Errorf("step %d cannot override schema-derived returned capability type bindings", index+1))
					}
				}
			}
		}
		context, err := context.withUserBindings(step.TypeBindings, plan.arena)
		if err != nil {
			return fail(fmt.Errorf("step %d type bindings: %w", index+1, err))
		}
		method, id, err := context.method(step.InterfaceID, step.Ordinal)
		if err != nil {
			return fail(fmt.Errorf("step %d: %w", index+1, err))
		}
		params, results, err := context.methodSchemas(method, step.MethodTypes, plan.arena)
		if err != nil {
			return fail(fmt.Errorf("step %d generic method: %w", index+1, err))
		}
		message, args, err := params.EncodeParams(method.ParamStructType(), step.Params)
		if err != nil {
			return fail(fmt.Errorf("step %d request parameters: %w", index+1, err))
		}
		plan.calls = append(plan.calls, preparedCall{method: method, interfaceID: id, input: step, arguments: message, args: args, results: results, parent: parent, offsets: offsets})
	}
	return plan, nil
}

// Promised paths are statically typed pointer fields; lists and union branches
// require value-dependent selection and cannot be used before an answer resolves.
func (s *Schema) capabilityAt(typeID uint64, path []string) (*Schema, uint64, []uint16, error) {
	if len(path) == 0 || len(path) > 8 {
		return nil, 0, nil, errors.New("choose a capability field path of one to eight names")
	}
	node, err := s.structNode(typeID)
	if err != nil {
		return nil, 0, nil, err
	}
	offsets := []uint16{}
	for index, name := range path {
		if !safeLabel(name, 128) {
			return nil, 0, nil, errors.New("invalid capability field name")
		}
		fields, err := node.StructNode().Fields()
		if err != nil {
			return nil, 0, nil, err
		}
		var field schema.Field
		for i := 0; i < fields.Len(); i++ {
			label, _ := fields.At(i).Name()
			if label == name {
				field = fields.At(i)
				break
			}
		}
		if !field.IsValid() {
			return nil, 0, nil, errors.New("capability field is not in the result schema")
		}
		if field.DiscriminantValue() != schema.Field_noDiscriminant {
			return nil, 0, nil, errors.New("union fields cannot be used as promised capability paths")
		}
		if field.Which() == schema.Field_Which_group {
			node, err = s.structNode(field.Group().TypeId())
			if err != nil {
				return nil, 0, nil, err
			}
			continue
		}
		typ, err := field.Slot().Type()
		if err != nil {
			return nil, 0, nil, err
		}
		s, typ, err = s.resolveType(typ)
		if err != nil {
			return nil, 0, nil, err
		}
		offsets = append(offsets, uint16(field.Slot().Offset()))
		if typ.Which() == schema.Type_Which_interface && index == len(path)-1 {
			brand, err := typ.Interface().Brand()
			if err != nil {
				return nil, 0, nil, err
			}
			id := typ.Interface().TypeId()
			owner, err := s.withBrand(brand, id)
			return owner, id, offsets, err
		}
		if typ.Which() != schema.Type_Which_structType || index == len(path)-1 {
			return nil, 0, nil, errors.New("capability path must end at an interface through concrete struct fields")
		}
		s, node, err = s.structContext(typ)
		if err != nil {
			return nil, 0, nil, err
		}
	}
	return nil, 0, nil, errors.New("capability path does not end at an interface")
}

func (s *Schema) capabilityPaths(typeID uint64, prefix []string, depth int) []CapabilityPath {
	result := []CapabilityPath{}
	budget := 256
	seen := map[uint64]bool{}
	var walk func(uint64, []string, int)
	walk = func(id uint64, prefix []string, depth int) {
		if depth > 4 || budget <= 0 || len(result) >= 32 || seen[id] {
			return
		}
		seen[id] = true
		defer delete(seen, id)
		node, err := s.structNode(id)
		if err != nil {
			return
		}
		fields, err := node.StructNode().Fields()
		if err != nil {
			return
		}
		for index := 0; index < fields.Len() && budget > 0 && len(result) < 32; index++ {
			budget--
			field := fields.At(index)
			if field.DiscriminantValue() != schema.Field_noDiscriminant {
				continue
			}
			name, _ := field.Name()
			path := append(append([]string{}, prefix...), name)
			if field.Which() == schema.Field_Which_group {
				walk(field.Group().TypeId(), path, depth+1)
				continue
			}
			typ, err := field.Slot().Type()
			if err != nil {
				continue
			}
			switch typ.Which() {
			case schema.Type_Which_interface:
				result = append(result, CapabilityPath{path, fmt.Sprintf("0x%x", typ.Interface().TypeId())})
			case schema.Type_Which_structType:
				walk(typ.StructType().TypeId(), path, depth+1)
			}
		}
	}
	walk(typeID, prefix, depth)
	return result
}
