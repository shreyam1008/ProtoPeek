import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HealthPanel } from './HealthPanel';
import type { HealthRun } from './health';

function renderPanel(overrides: Partial<Parameters<typeof HealthPanel>[0]> = {}) {
  const props: Parameters<typeof HealthPanel>[0] = {
    service: '',
    onServiceChange: vi.fn(),
    selectedService: 'catalog.v1.Catalog',
    serviceSuggestions: ['catalog.v1.Catalog', 'inventory.v1.Inventory'],
    checkDeadlineSeconds: 5,
    onCheckDeadlineChange: vi.fn(),
    watchDurationSeconds: 60,
    onWatchDurationChange: vi.fn(),
    run: null,
    busy: false,
    blockedBy: null,
    operationError: null,
    healthAdvertised: false,
    currentContextKey: 'direct:localhost:50051:0',
    currentTarget: 'localhost:50051',
    onCheck: vi.fn(),
    onWatch: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<HealthPanel {...props} />) };
}

function watchRun(overrides: Partial<HealthRun> = {}): HealthRun {
  return {
    operation: 'watch',
    phase: 'running',
    contextKey: 'workspace:old-session',
    target: 'old.internal:50051',
    service: 'catalog.v1.Catalog',
    startedAt: '2026-08-20T12:00:00.000Z',
    metadataCount: 1,
    checkDeadlineSeconds: null,
    watchDurationSeconds: 60,
    handlerInvokeMs: null,
    latestStatus: { code: 2, name: 'NOT_SERVING' },
    transitions: [
      {
        type: 'status-observed',
        service: 'catalog.v1.Catalog',
        startedAt: '2026-08-20T12:00:00.000Z',
        observedOffsetMs: 2,
        sequence: 1,
        servingStatus: { code: 1, name: 'SERVING' },
      },
      {
        type: 'status-observed',
        service: 'catalog.v1.Catalog',
        startedAt: '2026-08-20T12:00:00.000Z',
        observedOffsetMs: 7,
        sequence: 2,
        servingStatus: { code: 2, name: 'NOT_SERVING' },
      },
    ],
    droppedTransitions: 7,
    headers: [],
    trailers: [],
    headersTruncated: false,
    trailersTruncated: false,
    grpcStatus: null,
    endReason: null,
    observationCount: 2,
    error: '',
    ...overrides,
  };
}

describe('HealthPanel', () => {
  it('offers bounded Check/Watch controls and explains the gRPC-specific evidence boundary', () => {
    const { props } = renderPanel();

    expect(screen.getByRole('heading', { name: 'Health Check / Watch' })).toBeInTheDocument();
    expect(screen.getByText('Not advertised · direct probe still available')).toBeInTheDocument();
    expect(screen.getByLabelText('Health service')).toHaveAttribute(
      'placeholder',
      'Blank = overall server'
    );
    expect(screen.getByLabelText('Check deadline in seconds')).toHaveAttribute('min', '0.1');
    expect(screen.getByLabelText('Check deadline in seconds')).toHaveAttribute('max', '30');
    expect(screen.getByLabelText('Watch duration in seconds')).toHaveAttribute('min', '1');
    expect(screen.getByLabelText('Watch duration in seconds')).toHaveAttribute('max', '600');

    fireEvent.click(screen.getByRole('button', { name: 'Use selected service' }));
    expect(props.onServiceChange).toHaveBeenCalledWith('catalog.v1.Catalog');
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start Watch' }));
    expect(props.onCheck).toHaveBeenCalledOnce();
    expect(props.onWatch).toHaveBeenCalledOnce();

    expect(screen.getByText(/selected backend or replica/i)).toBeInTheDocument();
    expect(screen.getByText(/callback-observed lifecycle boundaries/i)).toBeInTheDocument();
    expect(
      screen.getByText(/editor metadata values are sent but never retained/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/no background retry/i)).toBeInTheDocument();
  });

  it('renders bounded partial Watch evidence, frozen attribution, and a real Cancel', () => {
    const onCancel = vi.fn();
    renderPanel({
      run: watchRun(),
      busy: true,
      currentTarget: 'old.internal:50051',
      currentContextKey: 'workspace:new-session',
      onCancel,
    });

    expect(screen.getByText('Previous connection')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAccessibleName(/previous connection/i);
    expect(screen.getByText('old.internal:50051')).toBeVisible();
    expect(screen.getByText(/60 s Watch duration/i)).toBeInTheDocument();
    expect(screen.getByText(/1 editor metadata entry/i)).toBeInTheDocument();
    expect(screen.getByText(/7 earlier transitions dropped/i)).toBeInTheDocument();
    expect(screen.getAllByText('SERVING')).not.toHaveLength(0);
    expect(screen.getAllByText('NOT_SERVING')).not.toHaveLength(0);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('status')).toHaveAttribute('aria-atomic', 'true');
    expect(screen.getByLabelText('Health status transitions')).not.toHaveAttribute('aria-live');
    expect(screen.getByLabelText('Health status transitions').parentElement).not.toHaveAttribute(
      'aria-live'
    );
    expect(screen.getByLabelText('Health service')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Watch' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('labels duration expiry as expected completion without hiding final gRPC status', () => {
    renderPanel({
      run: watchRun({
        phase: 'ended',
        grpcStatus: {
          code: 4,
          name: 'DeadlineExceeded',
          message: 'configured duration reached',
          messageTruncated: false,
        },
        endReason: 'duration-limit',
      }),
      busy: false,
    });

    expect(screen.getByText(/expected bounded completion/i)).toBeInTheDocument();
    expect(screen.getByText(/does not mark the service unhealthy/i)).toBeInTheDocument();
    expect(screen.getByText(/DeadlineExceeded/)).toBeInTheDocument();
  });

  it('keeps response headers and trailers inspectable as transport evidence', () => {
    renderPanel({
      run: watchRun({
        phase: 'ended',
        headers: [{ name: 'x-backend', value: 'blue-a' }],
        trailers: [{ name: 'grpc-status-details-bin', value: 'AQID' }],
        trailersTruncated: true,
        grpcStatus: { code: 0, name: 'OK', message: '', messageTruncated: false },
        endReason: 'completed',
      }),
      busy: false,
    });

    fireEvent.click(screen.getByText(/Response metadata · 1 headers · 1 trailers/));
    expect(screen.getByText('x-backend')).toBeVisible();
    expect(screen.getByText('blue-a')).toBeVisible();
    expect(screen.getByText('grpc-status-details-bin')).toBeVisible();
    expect(screen.getByText('AQID')).toBeVisible();
    expect(screen.getByText(/metadata evidence is incomplete or truncated/i)).toBeVisible();
  });
});
