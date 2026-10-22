import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CapnpAdvancedPanel } from './CapnpAdvancedPanel';
import type { CapnpMethod, CapnpSchema } from './capnp-api';

const method: CapnpMethod = {
  interfaceId: '0x123',
  interfaceName: 'fixture:Factory',
  ordinal: 0,
  name: 'create',
  paramsId: '0x11',
  resultsId: '0x12',
  fields: [],
  implicitParameters: ['T'],
  resultCapabilities: [{ path: ['child'], interfaceId: '0x456' }],
};
const child: CapnpMethod = {
  ...method,
  interfaceId: '0x456',
  interfaceName: 'fixture:Child',
  name: 'echo',
  implicitParameters: [],
};
const schema: CapnpSchema = { schemaBase64: 'AAAA', nodeCount: 4, methods: [method, child] };
const defaults = () => ({
  schema,
  method,
  params: '{"value":"hello"}',
  bindings: { methodTypes: ['Text'] },
  onBindingsChange: vi.fn(),
  onRun: vi.fn(),
  busy: false,
  executionIdentity: 'private-full-execution-a',
  targetLabel: 'localhost:7000 · verified TLS · 1s total timeout',
});

it('reviews without connecting and runs exactly the reviewed generic capability plan', () => {
  const props = defaults();
  render(<CapnpAdvancedPanel {...props} />);
  fireEvent.click(screen.getByText('Capability call plan · up to 8 steps'));
  expect(props.onRun).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Add step' }));
  fireEvent.change(screen.getByLabelText('Step 2 method'), { target: { value: '0x456/0' } });
  fireEvent.change(screen.getByLabelText('Step 2 target'), { target: { value: '0' } });
  expect(screen.getByLabelText('Step 2 capability path')).toHaveValue('child');
  fireEvent.change(screen.getByLabelText('Step 2 request JSON'), {
    target: { value: '{"value":9007199254740993}' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Review plan' }));
  expect(props.onRun).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Reviewed capability plan')).toHaveTextContent(props.targetLabel);
  fireEvent.click(screen.getByRole('button', { name: 'Run reviewed plan' }));
  expect(props.onRun).toHaveBeenCalledExactlyOnceWith([
    { interfaceId: '0x123', ordinal: 0, params: props.params, methodTypes: ['Text'] },
    {
      interfaceId: '0x456',
      ordinal: 0,
      params: '{"value":9007199254740993}',
      methodTypes: undefined,
      target: { step: 0, path: ['child'] },
    },
  ]);
  expect(screen.queryByRole('button', { name: 'Run reviewed plan' })).not.toBeInTheDocument();
});

it('invalidates review after a row or any private execution identity changes', () => {
  const props = defaults();
  const view = render(<CapnpAdvancedPanel {...props} />);
  fireEvent.click(screen.getByText('Capability call plan · up to 8 steps'));
  fireEvent.click(screen.getByRole('button', { name: 'Review plan' }));
  expect(screen.getByRole('button', { name: 'Run reviewed plan' })).toBeEnabled();
  view.rerender(<CapnpAdvancedPanel {...props} executionIdentity="private-CA-or-SNI-change" />);
  expect(screen.queryByRole('button', { name: 'Run reviewed plan' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Review plan' }));
  view.rerender(
    <CapnpAdvancedPanel {...props} params="{}" executionIdentity="private-CA-or-SNI-change" />
  );
  expect(screen.queryByRole('button', { name: 'Run reviewed plan' })).not.toBeInTheDocument();
  expect(props.onRun).not.toHaveBeenCalled();
});

it('uses current selected-method inputs for step one and invalidates their reviewed snapshot', () => {
  const props = defaults();
  const view = render(<CapnpAdvancedPanel {...props} />);
  fireEvent.click(screen.getByText('Capability call plan · up to 8 steps'));
  expect(screen.queryByLabelText('Step 1 method type T')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Step 1 request JSON')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Review plan' }));
  expect(screen.getByRole('button', { name: 'Run reviewed plan' })).toBeEnabled();
  view.rerender(
    <CapnpAdvancedPanel
      {...props}
      params='{"value":"changed"}'
      bindings={{ methodTypes: ['Data'] }}
    />
  );
  expect(screen.queryByRole('button', { name: 'Run reviewed plan' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Selected method method type T')).toHaveValue('Data');
  fireEvent.click(screen.getByRole('button', { name: 'Review plan' }));
  fireEvent.click(screen.getByRole('button', { name: 'Run reviewed plan' }));
  expect(props.onRun).toHaveBeenCalledExactlyOnceWith([
    { interfaceId: '0x123', ordinal: 0, params: '{"value":"changed"}', methodTypes: ['Data'] },
  ]);
});

it('requires explicit implicit-method types and bounds the plan at eight steps', () => {
  const props = defaults();
  render(<CapnpAdvancedPanel {...props} bindings={{}} />);
  fireEvent.click(screen.getByText('Capability call plan · up to 8 steps'));
  fireEvent.click(screen.getByRole('button', { name: 'Review plan' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Bind every generic method type');
  expect(screen.queryByRole('button', { name: 'Run reviewed plan' })).not.toBeInTheDocument();
  for (let index = 0; index < 7; index++)
    fireEvent.click(screen.getByRole('button', { name: 'Add step' }));
  expect(screen.getByRole('button', { name: 'Add step' })).toBeDisabled();
  expect(screen.getByRole('group', { name: 'Step 8' })).toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Step 9' })).not.toBeInTheDocument();
});

it('removes a cleared scope from the reviewed returned-capability step', () => {
  const props = defaults();
  const genericChild = {
    ...child,
    typeParameters: [{ name: 'T', scopeId: '0x456', index: 0 }],
  };
  render(<CapnpAdvancedPanel {...props} schema={{ ...schema, methods: [method, genericChild] }} />);
  fireEvent.click(screen.getByText('Capability call plan · up to 8 steps'));
  fireEvent.click(screen.getByRole('button', { name: 'Add step' }));
  fireEvent.change(screen.getByLabelText('Step 2 method'), { target: { value: '0x456/0' } });
  fireEvent.change(screen.getByLabelText('Step 2 target'), { target: { value: '0' } });
  const binding = screen.getByLabelText('Step 2 type T in 0x456');
  fireEvent.change(binding, { target: { value: 'Data' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review plan' }));
  expect(screen.getByRole('button', { name: 'Run reviewed plan' })).toBeEnabled();
  fireEvent.change(binding, { target: { value: '' } });
  expect(binding).toHaveValue('');
  expect(screen.queryByRole('button', { name: 'Run reviewed plan' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Review plan' }));
  fireEvent.click(screen.getByRole('button', { name: 'Run reviewed plan' }));
  expect(props.onRun).toHaveBeenCalledOnce();
  expect(props.onRun.mock.calls[0]?.[0][1]).toEqual({
    interfaceId: '0x456',
    ordinal: 0,
    params: '{}',
    target: { step: 0, path: ['child'] },
    methodTypes: undefined,
  });
  expect(props.onRun.mock.calls[0]?.[0][1]).not.toHaveProperty('typeBindings');
});

it('requires explicit sibling values instead of silently binding them to AnyPointer', () => {
  const props = defaults();
  const genericChild = {
    ...child,
    typeParameters: [
      { name: 'T', scopeId: '0x456', index: 0 },
      { name: 'U', scopeId: '0x456', index: 1 },
    ],
  };
  render(<CapnpAdvancedPanel {...props} schema={{ ...schema, methods: [method, genericChild] }} />);
  fireEvent.click(screen.getByText('Capability call plan · up to 8 steps'));
  fireEvent.click(screen.getByRole('button', { name: 'Add step' }));
  fireEvent.change(screen.getByLabelText('Step 2 method'), { target: { value: '0x456/0' } });
  fireEvent.change(screen.getByLabelText('Step 2 type T in 0x456'), {
    target: { value: 'Text' },
  });
  expect(screen.getByLabelText('Step 2 type U in 0x456')).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: 'Review plan' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Invalid generic scope bindings in step 2');
  expect(screen.queryByRole('button', { name: 'Run reviewed plan' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Step 2 type U in 0x456'), {
    target: { value: 'AnyPointer' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Review plan' }));
  fireEvent.click(screen.getByRole('button', { name: 'Run reviewed plan' }));
  expect(props.onRun.mock.calls[0]?.[0][1].typeBindings).toEqual({
    '0x456': ['Text', 'AnyPointer'],
  });
});
