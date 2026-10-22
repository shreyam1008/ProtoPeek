package capnpwork

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"strings"
	"sync"
	"testing"
	"time"

	"capnproto.org/go/capnp/v3"
	"capnproto.org/go/capnp/v3/rpc"
	"capnproto.org/go/capnp/v3/rpc/transport"
	"capnproto.org/go/capnp/v3/server"
	rpcschema "capnproto.org/go/capnp/v3/std/capnp/rpc"
	"capnproto.org/go/capnp/v3/std/capnp/schema"
)

const genericBase uint64 = 0x8000000000000100
const genericFactory = genericBase + 1
const genericAssignable = genericBase + 2
const genericCreateParams = genericBase + 3
const genericCreateResults = genericBase + 4
const genericEchoParams = genericBase + 5
const genericEchoResults = genericBase + 6

func bindingCheck(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
func parameterType(t *testing.T, typ schema.Type, scope uint64) {
	t.Helper()
	typ.SetAnyPointer()
	typ.AnyPointer().SetParameter()
	typ.AnyPointer().Parameter().SetScopeId(scope)
	typ.AnyPointer().Parameter().SetParameterIndex(0)
}
func implicitBrand(t *testing.T, brand schema.Brand, target uint64) {
	t.Helper()
	scopes, err := brand.NewScopes(1)
	bindingCheck(t, err)
	scopes.At(0).SetScopeId(target)
	values, err := scopes.At(0).NewBind(1)
	bindingCheck(t, err)
	typ, err := values.At(0).NewType()
	bindingCheck(t, err)
	typ.SetAnyPointer()
	typ.AnyPointer().SetImplicitMethodParameter()
	typ.AnyPointer().ImplicitMethodParameter().SetParameterIndex(0)
}

// The schema API builds the CodeGeneratorRequest described in testdata/generic.capnp.
// Its detached method structs deliberately exercise the scopeId=0 method-brand case.
func genericSchema(t *testing.T) *Schema {
	t.Helper()
	message, segment := capnp.NewSingleSegmentMessage(nil)
	defer message.Release()
	request, err := schema.NewRootCodeGeneratorRequest(segment)
	bindingCheck(t, err)
	nodes, err := request.NewNodes(7)
	bindingCheck(t, err)
	for index := 0; index < 7; index++ {
		node := nodes.At(index)
		node.SetId(genericBase + uint64(index))
		bindingCheck(t, node.SetDisplayName(fmt.Sprintf("generic.capnp:Node%d", index)))
	}
	nodes.At(0).SetFile()
	for _, index := range []int{1, 2} {
		node := nodes.At(index)
		node.SetInterface()
		node.SetScopeId(genericBase)
		methods, err := node.Interface().NewMethods(1)
		bindingCheck(t, err)
		method := methods.At(0)
		bindingCheck(t, method.SetName("echo"))
		if index == 1 {
			bindingCheck(t, method.SetName("create"))
			method.SetParamStructType(genericCreateParams)
			method.SetResultStructType(genericCreateResults)
			implicit, err := method.NewImplicitParameters(1)
			bindingCheck(t, err)
			bindingCheck(t, implicit.At(0).SetName("T"))
			brand, err := method.NewParamBrand()
			bindingCheck(t, err)
			implicitBrand(t, brand, genericCreateParams)
			brand, err = method.NewResultBrand()
			bindingCheck(t, err)
			implicitBrand(t, brand, genericCreateResults)
		} else {
			node.SetIsGeneric(true)
			parameters, err := node.NewParameters(1)
			bindingCheck(t, err)
			bindingCheck(t, parameters.At(0).SetName("T"))
			method.SetParamStructType(genericEchoParams)
			method.SetResultStructType(genericEchoResults)
			for _, makeBrand := range []func() (schema.Brand, error){method.NewParamBrand, method.NewResultBrand} {
				brand, err := makeBrand()
				bindingCheck(t, err)
				scopes, err := brand.NewScopes(1)
				bindingCheck(t, err)
				scopes.At(0).SetScopeId(genericAssignable)
				scopes.At(0).SetInherit()
			}
		}
	}
	for index := 3; index < 7; index++ {
		node := nodes.At(index)
		node.SetStructNode()
		node.SetIsGeneric(true)
		node.StructNode().SetPointerCount(1)
		node.StructNode().SetPreferredListEncoding(schema.ElementSize_inlineComposite)
		fields, err := node.StructNode().NewFields(1)
		bindingCheck(t, err)
		field := fields.At(0)
		field.SetSlot()
		field.SetDiscriminantValue(schema.Field_noDiscriminant)
		bindingCheck(t, field.SetName("value"))
		typ, err := field.Slot().NewType()
		bindingCheck(t, err)
		value, err := field.Slot().NewDefaultValue()
		bindingCheck(t, err)
		if index == 3 || index == 4 {
			parameters, err := node.NewParameters(1)
			bindingCheck(t, err)
			bindingCheck(t, parameters.At(0).SetName("T"))
		}
		if index == 4 {
			// Ordinal zero occupies physical pointer slot one. Pipelining uses
			// that offset, not the schema ordinal.
			node.StructNode().SetPointerCount(2)
			field.Slot().SetOffset(1)
			typ.SetInterface()
			typ.Interface().SetTypeId(genericAssignable)
			brand, err := typ.Interface().NewBrand()
			bindingCheck(t, err)
			scopes, err := brand.NewScopes(1)
			bindingCheck(t, err)
			scopes.At(0).SetScopeId(genericAssignable)
			values, err := scopes.At(0).NewBind(1)
			bindingCheck(t, err)
			binding, err := values.At(0).NewType()
			bindingCheck(t, err)
			parameterType(t, binding, genericCreateResults)
			value.SetInterface()
		} else {
			scope := genericAssignable
			if index == 3 {
				scope = genericCreateParams
			}
			parameterType(t, typ, scope)
			bindingCheck(t, value.SetAnyPointer(capnp.Ptr{}))
		}
	}
	raw, err := message.Marshal()
	bindingCheck(t, err)
	parsed, err := Parse(raw)
	bindingCheck(t, err)
	t.Cleanup(parsed.Close)
	return parsed
}

type observePromisedCodec struct {
	*wireCodec
	promised        chan struct{}
	once            sync.Once
	factoryQuestion uint32
	seenFactory     bool
}

func (codec *observePromisedCodec) Decode() (*capnp.Message, error) {
	message, err := codec.wireCodec.Decode()
	if err != nil {
		return message, err
	}
	root, err := rpcschema.ReadRootMessage(message)
	if err == nil && root.Which() == rpcschema.Message_Which_call {
		call, err := root.Call()
		if err == nil {
			if call.InterfaceId() == genericFactory {
				codec.factoryQuestion = call.QuestionId()
				codec.seenFactory = true
				return message, nil
			}
			target, err := call.Target()
			if err == nil && target.Which() == rpcschema.MessageTarget_Which_promisedAnswer {
				promise, err := target.PromisedAnswer()
				if err == nil && codec.seenFactory && promise.QuestionId() == codec.factoryQuestion {
					codec.once.Do(func() { close(codec.promised) })
				}
			}
		}
	}
	return message, nil
}

type signalShutdown struct {
	done chan struct{}
	once sync.Once
}

func (signal *signalShutdown) Shutdown() { signal.once.Do(func() { close(signal.done) }) }

func genericPeer(t *testing.T, requirePipeline bool) (string, <-chan struct{}) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	bindingCheck(t, err)
	t.Cleanup(func() { _ = listener.Close() })
	shutdown := &signalShutdown{done: make(chan struct{})}
	go func() {
		socket, err := listener.Accept()
		if err != nil {
			return
		}
		promised := make(chan struct{})
		codec := &observePromisedCodec{wireCodec: newWireCodec(socket), promised: promised}
		factory := capnp.NewClient(server.New([]server.Method{{Method: capnp.Method{InterfaceID: genericFactory, MethodID: 0}, Impl: func(ctx context.Context, call *server.Call) error {
			if requirePipeline {
				select {
				case <-promised:
				case <-ctx.Done():
					return ctx.Err()
				}
			}
			child := capnp.NewClient(server.New([]server.Method{{Method: capnp.Method{InterfaceID: genericAssignable, MethodID: 0}, Impl: func(_ context.Context, call *server.Call) error {
				pointer, err := call.Args().Ptr(0)
				if err != nil {
					return err
				}
				result, err := call.AllocResults(capnp.ObjectSize{PointerCount: 1})
				if err != nil {
					return err
				}
				return result.SetPtr(0, pointer)
			}}}, nil, shutdown))
			result, err := call.AllocResults(capnp.ObjectSize{PointerCount: 2})
			if err != nil {
				child.Release()
				return err
			}
			id := result.Message().CapTable().Add(child)
			return result.SetPtr(1, capnp.NewInterface(result.Segment(), id).ToPtr())
		}}}, nil, nil))
		connection := rpc.NewConn(transport.New(codec), &rpc.Options{BootstrapClient: factory, AbortTimeout: 100 * time.Millisecond})
		defer connection.Close()
		<-connection.Done()
	}()
	return listener.Addr().String(), shutdown.done
}

func TestGenericFactoryReturnedCapabilityUsesRealPipeliningAndReleases(t *testing.T) {
	for _, argument := range []string{"Text", "Data", "List(Text)", "List(Int32)"} {
		t.Run(argument, func(t *testing.T) {
			s := genericSchema(t)
			address, released := genericPeer(t, true)
			value := `"exact text"`
			if argument == "Data" {
				value = `"cmF3"`
			}
			if argument == "List(Text)" {
				value = `["one","two"]`
			}
			if argument == "List(Int32)" {
				value = `[-1,0,2147483647]`
			}
			result, err := s.Call(context.Background(), CallRequest{Address: address, Transport: "tcp", TimeoutMs: 2000, Steps: []CallStep{{InterfaceID: fmt.Sprintf("0x%x", genericFactory), MethodTypes: []string{argument}, Params: json.RawMessage(`{"value":` + value + `}`)}, {InterfaceID: fmt.Sprintf("0x%x", genericAssignable), Params: json.RawMessage(`{"value":` + value + `}`), Target: &CapabilityTarget{Step: 0, Path: []string{"value"}}}}})
			bindingCheck(t, err)
			if result.Plan == nil || !result.Plan.Completed || result.Plan.SentSteps != 2 || len(result.Plan.Steps) != 2 || strings.TrimSpace(string(result.Result)) != `{"value":`+value+`}` {
				t.Fatalf("generic pipelined result: %+v %s", result, string(result.Result))
			}
			select {
			case <-released:
			case <-time.After(time.Second):
				t.Fatal("returned capability was not released")
			}
		})
	}
}

func TestGenericBrandOmittedInheritAndExplicitSelfBindings(t *testing.T) {
	s := genericSchema(t)
	arena := newTypeArena()
	defer arena.message.Release()
	base, err := s.withUserBindings(map[string][]string{fmt.Sprintf("0x%x", genericCreateParams): {"Text"}}, arena)
	bindingCheck(t, err)
	for _, kind := range []string{"omitted", "inherit", "self"} {
		t.Run(kind, func(t *testing.T) {
			brand, err := schema.NewBrand(arena.segment)
			bindingCheck(t, err)
			if kind != "omitted" {
				scopes, err := brand.NewScopes(1)
				bindingCheck(t, err)
				scope := scopes.At(0)
				scope.SetScopeId(genericCreateParams)
				if kind == "inherit" {
					scope.SetInherit()
				} else {
					values, err := scope.NewBind(1)
					bindingCheck(t, err)
					typ, err := values.At(0).NewType()
					bindingCheck(t, err)
					parameterType(t, typ, genericCreateParams)
				}
			}
			context, err := base.withBrand(brand, genericCreateParams)
			bindingCheck(t, err)
			message, _, err := context.EncodeParams(genericCreateParams, json.RawMessage(`{"value":"typed"}`))
			if kind == "omitted" {
				if err == nil {
					message.Release()
					t.Fatal("omitted binding silently inherited Text")
				}
				return
			}
			bindingCheck(t, err)
			defer message.Release()
		})
	}
}

func TestGenericBindingsRejectInvalidTypesAndPlansBeforeConnecting(t *testing.T) {
	s := genericSchema(t)
	for _, argument := range []string{"Int32", "Bool", "0x123", strings.Repeat("List(", 20) + "Text" + strings.Repeat(")", 20)} {
		_, err := s.Call(context.Background(), CallRequest{Address: "127.0.0.1:1", Transport: "tcp", TimeoutMs: 100, InterfaceID: fmt.Sprintf("0x%x", genericFactory), Params: json.RawMessage(`{"value":"x"}`), MethodTypes: []string{argument}})
		if err == nil || strings.Contains(err.Error(), "connect:") {
			t.Fatalf("invalid type %q reached network: %v", argument, err)
		}
	}
	_, err := s.preparePlan(CallRequest{Steps: []CallStep{{InterfaceID: fmt.Sprintf("0x%x", genericFactory), Params: json.RawMessage(`{}`), MethodTypes: []string{"Text"}, Target: &CapabilityTarget{Step: 0, Path: []string{"value"}}}}})
	if err == nil {
		t.Fatal("forward capability reference accepted")
	}
	_, err = s.preparePlan(CallRequest{Steps: make([]CallStep, 9)})
	if err == nil {
		t.Fatal("ninth step accepted")
	}
}

func TestGenericPlanDeadlineRetainsHonestStepFailure(t *testing.T) {
	s := genericSchema(t)
	address, _ := genericPeer(t, true)
	result, err := s.Call(context.Background(), CallRequest{Address: address, Transport: "tcp", TimeoutMs: 100, Steps: []CallStep{{InterfaceID: fmt.Sprintf("0x%x", genericFactory), MethodTypes: []string{"Text"}, Params: json.RawMessage(`{"value":"x"}`)}}})
	bindingCheck(t, err)
	if result.Plan == nil || result.Plan.Completed || len(result.Plan.Steps) != 1 || !strings.Contains(result.Plan.Steps[0].Error, context.DeadlineExceeded.Error()) {
		t.Fatalf("deadline evidence: %+v", result.Plan)
	}
}

func TestGenericMethodParameterNestedInsideListBrand(t *testing.T) {
	s := genericSchema(t)
	method, _, err := s.method(fmt.Sprintf("0x%x", genericFactory), 0)
	bindingCheck(t, err)
	brand, err := method.NewParamBrand()
	bindingCheck(t, err)
	scopes, err := brand.NewScopes(1)
	bindingCheck(t, err)
	scopes.At(0).SetScopeId(genericCreateParams)
	values, err := scopes.At(0).NewBind(1)
	bindingCheck(t, err)
	typ, err := values.At(0).NewType()
	bindingCheck(t, err)
	typ.SetList()
	element, err := typ.List().NewElementType()
	bindingCheck(t, err)
	element.SetAnyPointer()
	element.AnyPointer().SetImplicitMethodParameter()
	element.AnyPointer().ImplicitMethodParameter().SetParameterIndex(0)
	arena := newTypeArena()
	defer arena.message.Release()
	params, _, err := s.methodSchemas(method, []string{"Text"}, arena)
	bindingCheck(t, err)
	message, args, err := params.EncodeParams(genericCreateParams, json.RawMessage(`{"value":["one","two"]}`))
	bindingCheck(t, err)
	defer message.Release()
	decoded, err := params.DecodeResults(genericCreateParams, args)
	bindingCheck(t, err)
	if strings.TrimSpace(string(decoded)) != `{"value":["one","two"]}` {
		t.Fatalf("nested generic result: %s", decoded)
	}
}

func TestGenericBindingsRejectDuplicateNumericScopes(t *testing.T) {
	s := genericSchema(t)
	arena := newTypeArena()
	defer arena.message.Release()
	_, err := s.withUserBindings(map[string][]string{
		fmt.Sprintf("0x%x", genericAssignable): {"Text"},
		fmt.Sprint(genericAssignable):          {"Data"},
	}, arena)
	if err == nil {
		t.Fatal("two spellings of the same scope could select an arbitrary binding")
	}
}

func TestReturnedCapabilityCannotOverrideDeclaredBrandBeforeConnecting(t *testing.T) {
	s := genericSchema(t)
	for _, binding := range []string{"Data", "Text", "List(Text)"} {
		_, err := s.Call(context.Background(), CallRequest{Address: "127.0.0.1:1", Transport: "tcp", TimeoutMs: 100,
			Steps: []CallStep{
				{InterfaceID: fmt.Sprintf("0x%x", genericFactory), MethodTypes: []string{"Text"}, Params: json.RawMessage(`{"value":"typed"}`)},
				{Target: &CapabilityTarget{Step: 0, Path: []string{"value"}}, TypeBindings: map[string][]string{fmt.Sprintf("0x%x", genericAssignable): {binding}}, Params: json.RawMessage(`{"value":"typed"}`)},
			},
		})
		if err == nil || !strings.Contains(err.Error(), "cannot override schema-derived") {
			t.Fatalf("binding %s bypassed the returned capability brand: %v", binding, err)
		}
	}
}

func TestReturnedCapabilityBindingScopeParseFailsClosedBeforeConnecting(t *testing.T) {
	s := genericSchema(t)
	for _, raw := range []string{"0" + fmt.Sprint(genericAssignable), "0xinvalid", "18446744073709551616"} {
		_, err := s.Call(context.Background(), CallRequest{Address: "127.0.0.1:1", Transport: "tcp", TimeoutMs: 100,
			Steps: []CallStep{
				{InterfaceID: fmt.Sprintf("0x%x", genericFactory), MethodTypes: []string{"Text"}, Params: json.RawMessage(`{"value":"typed"}`)},
				{Target: &CapabilityTarget{Step: 0, Path: []string{"value"}}, TypeBindings: map[string][]string{raw: {"Data"}}, Params: json.RawMessage(`{"value":"typed"}`)},
			},
		})
		if err == nil || !strings.Contains(err.Error(), "type binding scope is missing") || strings.Contains(err.Error(), "connect:") {
			t.Fatalf("invalid scope %q did not fail closed before the network: %v", raw, err)
		}
	}
}

func TestReturnedCapabilityInheritedConcreteBindingCannotBeOverridden(t *testing.T) {
	s := genericSchema(t)
	node := s.nodes[genericCreateResults]
	fields, err := node.StructNode().Fields()
	bindingCheck(t, err)
	typ, err := fields.At(0).Slot().Type()
	bindingCheck(t, err)
	brand, err := typ.Interface().NewBrand()
	bindingCheck(t, err)
	scopes, err := brand.NewScopes(1)
	bindingCheck(t, err)
	scopes.At(0).SetScopeId(genericAssignable)
	scopes.At(0).SetInherit()
	steps := []CallStep{
		{InterfaceID: fmt.Sprintf("0x%x", genericFactory), MethodTypes: []string{"Text"}, TypeBindings: map[string][]string{fmt.Sprintf("0x%x", genericAssignable): {"Text"}}, Params: json.RawMessage(`{"value":"typed"}`)},
		{Target: &CapabilityTarget{Step: 0, Path: []string{"value"}}, Params: json.RawMessage(`{"value":"typed"}`)},
	}
	plan, err := s.preparePlan(CallRequest{Steps: steps})
	bindingCheck(t, err)
	plan.close()
	steps[1].TypeBindings = map[string][]string{fmt.Sprintf("0x%x", genericAssignable): {"Data"}}
	_, err = s.Call(context.Background(), CallRequest{Address: "127.0.0.1:1", Transport: "tcp", TimeoutMs: 100, Steps: steps})
	if err == nil || !strings.Contains(err.Error(), "cannot override schema-derived") {
		t.Fatalf("inherited concrete binding was replaceable: %v", err)
	}
}
