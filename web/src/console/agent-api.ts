import { fetchJSON } from './api';

export type AgentTool = {
  name: string;
  description: string;
  inputSchema: unknown;
  route: string;
  writes: boolean;
};
export type AgentReceipt = {
  id: string;
  tool: string;
  route: string;
  state: string;
  startedAt: string;
  durationMs: number;
  status: number;
};
export type AgentState = {
  executable: string;
  connectionFile: string;
  instance: string;
  enabled: boolean;
  allowWrites: boolean;
  revision: number;
  records: AgentReceipt[];
  tools: AgentTool[];
};
export type AgentResult = {
  id: string;
  state: string;
  status: number;
  data?: unknown;
  preview?: string;
  truncated: boolean;
};

export function agentFetch<T>(path: string, signal: AbortSignal, body?: unknown) {
  const token = document.cookie.match(/(?:^|;\s*)_protopeek_csrf_token=([^;]+)/)?.[1] ?? '';
  return fetchJSON<T>(`api/agent/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    signal,
    headers: {
      'x-protopeek-csrf-token': token,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
