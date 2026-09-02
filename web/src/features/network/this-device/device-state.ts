import { ThisPCAPIError } from '@/console/this-pc-api';

export type DeviceView = 'overview' | 'listeners' | 'activity' | 'benchmark';

export type Resource<T> =
  | { status: 'loading'; value?: undefined; error?: undefined }
  | { status: 'ready'; value: T; error?: undefined }
  | { status: 'error'; value?: undefined; error: string };

export type IdleResource<T> = Resource<T> | { status: 'idle' };

export type QualityPlanStage =
  | 'idle'
  | 'consent'
  | 'loading'
  | 'running'
  | 'stopped'
  | 'finished'
  | 'error';

export function deviceErrorMessage(error: unknown, fallback: string) {
  if (error instanceof DOMException && error.name === 'AbortError') return '';
  if (error instanceof ThisPCAPIError) {
    if (error.status === 403) return 'This local inspection is restricted by the running build.';
    if (error.status === 404 || error.status === 501) {
      return 'This capability is not available in the running ProtoPeek build.';
    }
    return error.message || fallback;
  }
  return error instanceof Error && error.message ? error.message.slice(0, 2048) : fallback;
}
