import { compactDate } from '../../shared/utils';

import type { HandoffProvenance } from './handoff-types';

export function handoffEvidence(provenance: HandoffProvenance, memoryOnly = false) {
  const source =
    provenance.source === 'bounded-discovery'
      ? 'ProtoPeek discovery'
      : provenance.source === 'cloudflare-config'
        ? 'an observed Cloudflare ingress'
        : provenance.source.startsWith('legacy-')
          ? 'a legacy browser handoff'
          : provenance.source.replace(/[._-]+/g, ' ');
  const quality =
    provenance.quality === 'observed'
      ? 'Observed evidence'
      : provenance.quality === 'inferred'
        ? 'Inferred draft'
        : 'Manual draft';
  return `Draft from ${source}. ${quality} captured ${compactDate(provenance.observedAt)}${memoryOnly ? '. Browser session storage was unavailable, so this draft could not survive a reload' : ''}`;
}
