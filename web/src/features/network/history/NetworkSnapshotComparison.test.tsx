import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { NetworkSnapshot } from '@/console/network-model';
import NetworkSnapshotComparison from './NetworkSnapshotComparison';

const a: NetworkSnapshot = {
  id: 'a',
  label: 'Before',
  tags: [],
  notes: '',
  observedAt: '2026-10-22T12:00:00Z',
  nodes: [],
  edges: [],
  groups: [],
  provenance: [],
};
const b: NetworkSnapshot = {
  ...a,
  id: 'b',
  label: 'After',
  observedAt: '2026-10-22T13:00:00Z',
  nodes: Array.from({ length: 30 }, (_, index) => ({
    id: `host-${index}`,
    label: `Host ${index}`,
    tags: [],
    notes: '',
    deviceType: '',
    firstSeen: a.observedAt,
    lastSeen: a.observedAt,
    identities: [{ kind: 'ipv4', value: `192.0.2.${index + 1}`, provenance: [] }],
    ports: [],
    groupIds: [],
    position: { x: 0, y: 0, pinned: false },
    provenance: [],
  })),
};

it('compares explicit immutable A/B choices, pages every change and keeps availability caveats visible', () => {
  render(<NetworkSnapshotComparison snapshots={[a, b]} />);
  expect(screen.getByRole('status')).toHaveTextContent('30 added');
  expect(screen.getByText(/does not prove an outage/)).toBeVisible();
  expect(screen.getByText('Host 24')).toBeVisible();
  expect(screen.queryByText('Host 25')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next changes' }));
  expect(screen.getByText('Host 29')).toBeVisible();
  fireEvent.change(screen.getByLabelText('Observation A'), { target: { value: 'b' } });
  expect(screen.getByRole('status')).toHaveTextContent('Choose two different observations');
  fireEvent.change(screen.getByLabelText('Observation B'), { target: { value: 'a' } });
  expect(screen.getByRole('status')).toHaveTextContent('30 not observed');
});
