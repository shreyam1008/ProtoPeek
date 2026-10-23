import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import PacketReconstruction from './PacketReconstruction';

const evidence = {
  flows: [
    {
      id: 'tcp-1',
      section: 1,
      interface: 0,
      firstPacket: 1,
      lastPacket: 3,
      limited: false,
      directions: [
        {
          source: '192.0.2.1:40000',
          destination: '192.0.2.2:443',
          startObserved: true,
          endObserved: false,
          sequenceAmbiguous: false,
          conflictsLimited: false,
          segments: [
            { packet: 2, sequence: 1, offset: 0, data: 'aGVsbG8=' },
            { packet: 3, sequence: 2, offset: 1, data: 'QUxM' },
          ],
          gaps: [],
          conflicts: [{ start: 1, end: 4 }],
        },
        {
          source: '192.0.2.2:443',
          destination: '192.0.2.1:40000',
          startObserved: false,
          endObserved: false,
          sequenceAmbiguous: false,
          conflictsLimited: false,
          segments: [],
          gaps: [],
          conflicts: [],
        },
      ],
    },
  ],
  retainedBytes: 8,
  limited: false,
  skippedFragments: 0,
};

it('shows directional boundaries and conflict truth, and provides an exact hex view', () => {
  render(<PacketReconstruction value={evidence} />);
  expect(screen.getByText(/Conflicting overlap: offsets 1–3/)).toBeVisible();
  expect(screen.getByText('hello')).not.toBeVisible();
  expect(screen.getByText(/Start SYN observed/)).toBeVisible();
  fireEvent.change(screen.getByLabelText('Payload display'), { target: { value: 'hex' } });
  expect(screen.getByText('68')).toBeVisible();
  expect(screen.getByText('6f')).toBeVisible();
});

it('renders a bounded validation failure without exposing malformed content', () => {
  render(<PacketReconstruction value={{ flows: ['private-content'] }} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Invalid or excessive TCP reconstruction');
  expect(screen.queryByText('private-content')).not.toBeInTheDocument();
});
