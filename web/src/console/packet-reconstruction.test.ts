import { describe, expect, it } from 'vitest';
import { parseTCPReconstruction, reconstructDirection } from './packet-reconstruction';

function reconstructionFixture() {
  const direction = {
    source: '[192.0.2.1]:40000',
    destination: '[192.0.2.2]:443',
    startObserved: true,
    endObserved: false,
    sequenceAmbiguous: false,
    conflictsLimited: false,
    segments: [
      { packet: 2, sequence: 0xfffffff9, offset: 0, data: btoa('hello') },
      { packet: 3, sequence: 0xfffffffa, offset: 1, data: btoa('ALL') },
      { packet: 4, sequence: 3, offset: 10, data: btoa('!') },
    ],
    gaps: [{ start: 5, end: 10 }],
    conflicts: [{ start: 1, end: 4 }],
  };
  return {
    flows: [
      {
        id: 'tcp-1',
        section: 0,
        interface: 0,
        firstPacket: 1,
        lastPacket: 4,
        limited: false,
        directions: [
          direction,
          {
            ...direction,
            source: direction.destination,
            destination: direction.source,
            startObserved: false,
            segments: [],
            gaps: [],
            conflicts: [],
          },
        ],
      },
    ],
    retainedBytes: 9,
    limited: false,
    skippedFragments: 0,
  };
}
describe('bounded TCP payload evidence', () => {
  it('leaves gaps and contradictory bytes out of the combined preview', () => {
    const result = parseTCPReconstruction(reconstructionFixture());
    const blocks = reconstructDirection(result.flows[0].directions[0]);
    expect(
      blocks.map((block) => ({
        start: block.start,
        text: new TextDecoder().decode(Uint8Array.from(block.bytes)),
      }))
    ).toEqual([
      { start: 0, text: 'h' },
      { start: 4, text: 'o' },
      { start: 10, text: '!' },
    ]);
    expect(result.flows[0].directions[0].segments[1].bytes).toEqual(Uint8Array.from([65, 76, 76]));
  });
  it('accepts up to 64 KiB per flow and rejects excessive totals, segments or malformed base64', () => {
    const fixture = reconstructionFixture();
    fixture.flows[0].directions[0].segments = [
      { packet: 2, sequence: 1, offset: 0, data: btoa('x'.repeat(65536)) },
    ];
    fixture.flows[0].directions[0].conflicts = [];
    fixture.flows[0].directions[0].gaps = [];
    fixture.retainedBytes = 65536;
    expect(parseTCPReconstruction(fixture).retainedBytes).toBe(65536);
    fixture.flows[0].directions[0].segments[0].data = btoa('x'.repeat(65537));
    expect(() => parseTCPReconstruction(fixture)).toThrow('excessive');
    const corrupt = reconstructionFixture();
    corrupt.flows[0].directions[0].segments[0].data = 'bad?';
    expect(() => parseTCPReconstruction(corrupt)).toThrow('Invalid');
    expect(() =>
      parseTCPReconstruction({ ...reconstructionFixture(), retainedBytes: 100 })
    ).toThrow('Invalid');
  });
  it('withholds combined bytes when conflict detail is incomplete and rejects duplicated evidence', () => {
    const fixture = reconstructionFixture();
    fixture.flows[0].directions[0].conflictsLimited = true;
    expect(reconstructDirection(parseTCPReconstruction(fixture).flows[0].directions[0])).toEqual(
      []
    );
    fixture.flows[0].directions[0].segments[1].packet = 2;
    expect(() => parseTCPReconstruction(fixture)).toThrow('Invalid');
  });
});
