import type {
  BootstrapMethod,
  BootstrapResponse,
  InvokeResponse,
  SchemaResponse,
} from '@/shared/types';
import { GrpcMetric } from '../GrpcViewPrimitives';

export function TransportView({
  bootstrap,
  schema,
  method,
  invokeResult,
  responsePayload,
}: {
  bootstrap: BootstrapResponse;
  schema: SchemaResponse;
  method: BootstrapMethod;
  invokeResult: InvokeResponse | null;
  responsePayload: unknown[];
}) {
  const headerCount = invokeResult?.headers.length ?? 0;
  const trailerCount = invokeResult?.trailers.length ?? 0;
  const status = invokeResult?.error?.name ?? (invokeResult ? 'OK' : '—');
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <GrpcMetric label="Discovery" value={bootstrap.services.length > 0 ? 'Loaded' : 'N/A'} />
        <GrpcMetric label="Request" value={schema.requestStream ? 'Client stream' : 'Unary'} />
        <GrpcMetric label="Headers" value={String(headerCount)} />
        <GrpcMetric label="Trailers" value={String(trailerCount)} />
      </div>
      <div className="pp-panel text-sm">
        <p>
          <strong>Target:</strong> {bootstrap.target} at {bootstrap.basePath}
        </p>
        <p>
          <strong>Mode:</strong>{' '}
          {method.clientStreaming || method.serverStreaming ? 'Stream-aware' : 'Unary'}
        </p>
        <p>
          <strong>Last status:</strong> {status}, {responsePayload.length} message
          {responsePayload.length !== 1 ? 's' : ''}
        </p>
      </div>
      <div className="pp-panel text-xs text-pp-muted">
        <p className="font-semibold text-pp-ink">gRPC transport notes</p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>Proto files define the contract; reflection discovers services at runtime.</li>
          <li>Metadata (headers) carry auth, trace IDs, deadlines before payloads.</li>
          <li>Unary, client stream, server stream, and bidi are all supported.</li>
          <li>Final status and trailing metadata arrive after response messages.</li>
        </ul>
      </div>
    </div>
  );
}
