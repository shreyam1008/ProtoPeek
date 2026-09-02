import { Globe2 } from 'lucide-react';

import type {
  ThisPCCapabilities,
  ThisPCFamily,
  ThisPCPublicFamilyResult,
  ThisPCPublicIdentity,
} from '@/console/this-pc-api';

import { ConsentPrompt } from './ConsentPrompt';
import type { IdleResource, Resource } from './device-state';

function PublicFamily({ result }: { result: ThisPCPublicFamilyResult }) {
  return (
    <article className={`this-pc-public-family is-${result.status}`}>
      <header>
        <strong>Public {result.family === 'ipv4' ? 'IPv4' : 'IPv6'}</strong>
        <span>{result.status === 'ok' ? 'Observed' : 'Unavailable'}</span>
      </header>
      <code>{result.address ?? '—'}</code>
      {result.error ? <p>{result.error}</p> : null}
      {result.bgpOriginNetwork ? (
        <dl>
          <div>
            <dt>{result.bgpOriginNetwork.label}</dt>
            <dd>{result.bgpOriginNetwork.prefix}</dd>
          </div>
          <div>
            <dt>ASN</dt>
            <dd>{result.bgpOriginNetwork.asn}</dd>
          </div>
          {result.bgpOriginNetwork.name ? (
            <div>
              <dt>BGP origin registry name</dt>
              <dd>{result.bgpOriginNetwork.name}</dd>
            </div>
          ) : null}
          <div>
            <dt>Evidence</dt>
            <dd>Provider-reported by Team Cymru</dd>
          </div>
        </dl>
      ) : (
        <small>
          BGP origin network: {result.bgpOriginError || result.bgpOriginStatus.replace('-', ' ')}
        </small>
      )}
    </article>
  );
}

export function PublicAddressPanel({
  capabilities,
  state,
  consentOpen,
  acknowledged,
  families,
  onOpen,
  onAcknowledged,
  onFamilies,
  onConfirm,
  onCancel,
}: {
  capabilities: Resource<ThisPCCapabilities>;
  state: IdleResource<ThisPCPublicIdentity>;
  consentOpen: boolean;
  acknowledged: boolean;
  families: ThisPCFamily[];
  onOpen: () => void;
  onAcknowledged: (value: boolean) => void;
  onFamilies: (families: ThisPCFamily[]) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const publicCapability =
    capabilities.status === 'ready' ? capabilities.value.publicIdentity : null;
  const disabled = !publicCapability?.supported;
  return (
    <section className="this-pc-panel this-pc-public" aria-labelledby="this-pc-public-title">
      <header>
        <div>
          <h2 id="this-pc-public-title">Public identity</h2>
          <p>Your public addresses and BGP origin evidence stay hidden until you check.</p>
        </div>
      </header>
      {state.status === 'ready' ? (
        <div className="this-pc-public-results">
          {state.value.families.map((family) => (
            <PublicFamily key={family.family} result={family} />
          ))}
          <p>{state.value.externalRequestDisclosure}</p>
        </div>
      ) : state.status === 'loading' ? (
        <p className="this-pc-empty" role="status">
          Contacting the disclosed public providers once…
        </p>
      ) : state.status === 'error' ? (
        <p className="this-pc-inline-error" role="alert">
          {state.error}
        </p>
      ) : (
        <dl className="this-pc-public-placeholder">
          <div>
            <dt>Public IPv4</dt>
            <dd>—</dd>
          </div>
          <div>
            <dt>Public IPv6</dt>
            <dd>—</dd>
          </div>
          <div>
            <dt>BGP origin network</dt>
            <dd>—</dd>
          </div>
        </dl>
      )}
      {consentOpen ? (
        <ConsentPrompt
          title="Check public IPv4 and IPv6"
          acknowledged={acknowledged}
          onAcknowledged={onAcknowledged}
          acknowledgement="I understand this makes the disclosed external requests once."
          onConfirm={onConfirm}
          onCancel={onCancel}
          confirmLabel="Check selected families"
          disabled={!families.length}
        >
          <p>
            ProtoPeek will ask ipify for each selected address family. For a returned address, it
            may ask Team Cymru for provider-reported BGP origin network evidence.
          </p>
          <p>{publicCapability?.dnsResolverDisclosure}</p>
          <fieldset>
            <legend>Address families</legend>
            {(['ipv4', 'ipv6'] as const).map((family) => (
              <label key={family}>
                <input
                  type="checkbox"
                  checked={families.includes(family)}
                  onChange={(event) =>
                    onFamilies(
                      event.target.checked
                        ? [...families, family]
                        : families.filter((value) => value !== family)
                    )
                  }
                />
                {family === 'ipv4' ? 'IPv4' : 'IPv6'}
              </label>
            ))}
          </fieldset>
        </ConsentPrompt>
      ) : (
        <button
          type="button"
          className="this-pc-button is-wide"
          onClick={onOpen}
          disabled={disabled}
        >
          <Globe2 aria-hidden="true" />
          {state.status === 'ready' ? 'Check public identity again' : 'Check public identity'}
        </button>
      )}
      <small className="this-pc-action-note">
        {disabled
          ? publicCapability?.reason || 'Public identity capability is unavailable.'
          : 'No external request is made on page load.'}
      </small>
    </section>
  );
}
