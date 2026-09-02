import { ExternalLink, History, MoreHorizontal, Plus, Route as RouteIcon } from 'lucide-react';
import { type PlannedTunnelRoute, routeSupportsWorkbench } from '@/console/tunnels/route-plan';
import type { TunnelConfigSource, TunnelDeployment, TunnelRoute } from '@/console/tunnels-api';
import { attributedConfigSource, ConfigEvidence } from './ConfigEvidence';
import { copyText, routeCountLabel } from './view-helpers';

export function IngressEvidence({
  deployment,
  routes,
  selectedRouteID,
  configSources,
  onSelectRoute,
  onAdd,
  onRemoveDraft,
  onNotice,
}: {
  deployment: TunnelDeployment;
  routes: Array<TunnelRoute | PlannedTunnelRoute>;
  selectedRouteID: string;
  configSources: TunnelConfigSource[];
  onSelectRoute: (value: string) => void;
  onAdd: () => void;
  onRemoveDraft: (value: string) => void;
  onNotice: (value: string) => void;
}) {
  const activeConfig = attributedConfigSource(deployment, configSources);
  return (
    <div className="pp-tunnel-route-panel">
      <div className="pp-tunnel-panel-heading">
        <div>
          <span className="pp-tunnel-section-label">Ingress</span>
          <h3>{routeCountLabel(routes)}</h3>
        </div>
        <button type="button" className="pp-tunnel-text-action" onClick={onAdd}>
          <Plus aria-hidden="true" /> Draft ingress route
        </button>
      </div>
      {routes.length ? (
        <table className="pp-tunnel-route-table">
          <caption className="pp-sr-only">Ingress routes</caption>
          <thead>
            <tr className="pp-tunnel-route-table-head">
              <th scope="col">Hostname</th>
              <th scope="col">Protocol</th>
              <th scope="col">Origin service</th>
              <th scope="col">
                <span className="pp-sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {routes.map((route) => {
              const planned = 'planned' in route && route.planned;
              return (
                <tr
                  key={route.id}
                  data-origin={planned ? 'draft' : 'observed'}
                  className={`pp-tunnel-route-row ${selectedRouteID === route.id ? 'is-selected' : ''}`}
                >
                  <td className="pp-tunnel-route-host">
                    <button
                      type="button"
                      aria-current={selectedRouteID === route.id ? 'true' : undefined}
                      onClick={() => onSelectRoute(route.id)}
                    >
                      <strong>
                        {route.catchAll ? 'Catch-all' : route.hostname || 'Hostname not set'}
                      </strong>
                      <small>
                        {route.path || (route.catchAll ? 'Final fallback rule' : 'All paths')}
                      </small>
                    </button>
                  </td>
                  <td>
                    <span className={`pp-tunnel-protocol is-${route.protocol}`}>
                      {planned ? 'planned · ' : ''}
                      {route.protocol}
                    </span>
                  </td>
                  <td>
                    <code>{route.service || 'No service'}</code>
                  </td>
                  <td className="pp-tunnel-route-actions">
                    <details>
                      <summary aria-label={`Actions for ${route.hostname || 'catch-all route'}`}>
                        <MoreHorizontal aria-hidden="true" />
                      </summary>
                      <div className="pp-tunnel-route-menu">
                        <button type="button" onClick={() => onSelectRoute(route.id)}>
                          Select route
                        </button>
                        <button
                          type="button"
                          onClick={() => void copyText(route.service, onNotice)}
                        >
                          Copy origin
                        </button>
                        {planned ? (
                          <button
                            type="button"
                            className="is-danger"
                            onClick={() => onRemoveDraft(route.id)}
                          >
                            Remove draft
                          </button>
                        ) : null}
                      </div>
                    </details>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="pp-tunnel-inline-empty">
          <RouteIcon aria-hidden="true" />
          <div>
            <strong>No local ingress rules observed</strong>
            <p>
              {deployment.managementMode === 'remote'
                ? 'Routes are controlled by the Cloudflare account; account access is not connected.'
                : 'This deployment has no readable ingress list.'}
            </p>
          </div>
          <button type="button" onClick={onAdd}>
            Draft the first route
          </button>
        </div>
      )}
      <ConfigEvidence active={activeConfig} deployment={deployment} />
    </div>
  );
}

export function IngressHandoffs({
  route,
  onHandoff,
  onViewHistory,
}: {
  route: TunnelRoute | PlannedTunnelRoute | null;
  onHandoff: (kind: 'http' | 'grpc') => void;
  onViewHistory: () => void;
}) {
  const planned = Boolean(route && 'planned' in route && route.planned);
  return (
    <section
      className="pp-tunnel-handoffs"
      aria-label="Open selected origin in a ProtoPeek workbench"
    >
      <div>
        <span className="pp-tunnel-section-label">
          {planned ? 'Draft origin · not observed' : 'Observed origin'}
        </span>
        <strong>{route && !route.catchAll ? route.service : 'Select a routed origin'}</strong>
        <small>
          {planned
            ? 'This browser-only draft has not been applied or inspected on the host.'
            : 'Continue debugging in a ProtoPeek protocol workbench.'}
        </small>
      </div>
      <button
        type="button"
        disabled={!routeSupportsWorkbench(route, 'http')}
        title={planned ? 'Browser-only drafts are not observed host evidence.' : undefined}
        onClick={() => onHandoff('http')}
      >
        <ExternalLink aria-hidden="true" /> Open in HTTP
      </button>
      <button
        type="button"
        disabled={!routeSupportsWorkbench(route, 'grpc')}
        title={planned ? 'Browser-only drafts are not observed host evidence.' : undefined}
        onClick={() => onHandoff('grpc')}
      >
        <ExternalLink aria-hidden="true" /> Open in gRPC
      </button>
      <button type="button" onClick={onViewHistory}>
        <History aria-hidden="true" /> View change history
      </button>
    </section>
  );
}
