import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentWorkbench } from './AgentWorkbench';
import { type AgentState, agentFetch } from './agent-api';

vi.mock('./agent-api', () => ({ agentFetch: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
let state: AgentState;
let waitSignal: AbortSignal | undefined;

beforeEach(() => {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  state = {
    executable: 'protopeek',
    connectionFile: '/tmp/agent.json',
    instance: 'first',
    enabled: false,
    allowWrites: false,
    revision: 0,
    records: [],
    tools: [],
  };
  vi.mocked(agentFetch).mockImplementation(async (path, signal, body) => {
    if (path.startsWith('state?')) {
      waitSignal = signal;
      return await new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      );
    }
    if (path.startsWith('result?'))
      return {
        id: 'one',
        state: 'completed',
        status: 200,
        data: {
          status: '200 OK',
          statusCode: 200,
          proto: 'HTTP/1.1',
          headers: [],
          body: 'actual response',
          bodyEncoding: 'text',
          bytes: 15,
          truncated: false,
          redirects: [],
          remoteIp: '127.0.0.1',
          tls: null,
          timings: { dnsMs: 0, connectMs: 0, tlsMs: 0, ttfbMs: 1, totalMs: 2 },
        },
        truncated: false,
      } as never;
    if (path === 'control') {
      const input = body as { action: string; allowWrites: boolean };
      state = {
        ...state,
        revision: state.revision + 1,
        enabled: input.action === 'enable',
        allowWrites: input.action === 'enable' && input.allowWrites,
      };
      if (input.action === 'cancel')
        state.records = state.records.map((item) => ({ ...item, state: 'cancelled' }));
      if (input.action === 'clear') state.records = [];
    }
    return state as never;
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  waitSignal = undefined;
});

describe('AI agent workbench', () => {
  it('accepts a lower revision from a newly started workbench', async () => {
    state = { ...state, enabled: true, revision: 20 };
    render(<AgentWorkbench />);
    await screen.findByRole('button', { name: 'Disable and cancel active calls' });
    state = { ...state, instance: 'restarted', enabled: false, revision: 0 };
    fireEvent.click(screen.getByRole('button', { name: 'Refresh agent activity' }));
    expect(await screen.findByRole('button', { name: 'Enable agent connection' })).toBeEnabled();
  });
  it('pairs explicitly, shares a secret-free config and revokes access', async () => {
    render(<AgentWorkbench />);
    const enable = await screen.findByRole('button', { name: 'Enable agent connection' });
    await waitFor(() => expect(enable).toBeEnabled());
    expect(screen.getByRole('checkbox', { name: 'Allow write actions' })).not.toBeChecked();
    expect(await screen.findByLabelText('MCP configuration')).toHaveTextContent(
      '"command": "protopeek"'
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Allow write actions' }));
    fireEvent.click(enable);
    expect(
      await screen.findByRole('button', { name: 'Disable and cancel active calls' })
    ).toBeEnabled();
    expect(agentFetch).toHaveBeenCalledWith('control', expect.any(AbortSignal), {
      action: 'enable',
      id: undefined,
      allowWrites: true,
    });
    expect(screen.getByRole('checkbox', { name: 'Allow write actions' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Disable and cancel active calls' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Enable agent connection' })).toBeEnabled()
    );
  });

  it('shows returned evidence, links its native workspace, and clears it', async () => {
    state.records = [
      {
        id: 'one',
        tool: 'http_request',
        route: '/protocols/http',
        state: 'completed',
        startedAt: '2026-09-07T00:00:00Z',
        durationMs: 12,
        status: 200,
      },
    ];
    render(<AgentWorkbench />);
    expect(await screen.findByRole('region', { name: 'HTTP response evidence' })).toHaveTextContent(
      'actual response'
    );
    expect(screen.getByRole('link', { name: 'Open HTTP' })).toHaveAttribute(
      'href',
      '/protocols/http'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear finished' }));
    expect(
      await screen.findByRole('heading', { name: 'Watch your agent work' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'HTTP response evidence' })
    ).not.toBeInTheDocument();
  });

  it('cancels the selected running call and stops waiting when unmounted', async () => {
    state.enabled = true;
    state.records = [
      {
        id: 'one',
        tool: 'http_request',
        route: '/protocols/http',
        state: 'running',
        startedAt: '2026-09-07T00:00:00Z',
        durationMs: 0,
        status: 0,
      },
    ];
    const rendered = render(<AgentWorkbench />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel http_request' }));
    await waitFor(() =>
      expect(agentFetch).toHaveBeenCalledWith(
        'control',
        expect.any(AbortSignal),
        expect.objectContaining({ action: 'cancel', id: 'one' })
      )
    );
    await waitFor(() => expect(waitSignal).toBeDefined());
    const signal = waitSignal;
    rendered.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('reports connection failures and permits an explicit retry', async () => {
    vi.mocked(agentFetch).mockRejectedValue(new Error('local browser session required'));
    render(<AgentWorkbench />);
    expect(await screen.findByRole('alert')).toHaveTextContent('open this workbench via 127.0.0.1');
    expect(screen.getByText('Connection unavailable')).toBeInTheDocument();
    const activity = within(screen.getByRole('region', { name: 'Agent activity' }));
    expect(activity.getByRole('status')).toHaveTextContent('Refresh agent activity to retry');
    expect(activity.getByRole('status').querySelector('.pp-agent-spin')).toBeNull();
    expect(screen.queryByText('Connecting…')).not.toBeInTheDocument();
    expect(screen.queryByText('Loading connection and activity…')).not.toBeInTheDocument();
    expect(screen.queryByText(/Pairing file unavailable/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'MCP client configuration' })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Live' })).not.toBeChecked();
    vi.mocked(agentFetch).mockResolvedValue(state);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh agent activity' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Enable agent connection' })).toBeEnabled();
    expect(screen.getByText('Connection off')).toBeInTheDocument();
    expect(screen.queryByText('Connection unavailable')).not.toBeInTheDocument();
  });

  it('waits for the actual state before offering client configuration or missing-file guidance', async () => {
    let finish: (value: AgentState) => void = () => {};
    vi.mocked(agentFetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    render(<AgentWorkbench />);
    expect(screen.getByText('Loading client configuration…')).toBeInTheDocument();
    expect(screen.queryByText(/Pairing file unavailable/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Copy MCP configuration' })
    ).not.toBeInTheDocument();
    await act(async () => finish(state));
    expect(await screen.findByRole('button', { name: 'Copy MCP configuration' })).toBeEnabled();
    expect(screen.getByLabelText('MCP configuration')).toHaveTextContent(state.connectionFile);
    fireEvent.click(screen.getByText('Data and limits'));
    expect(screen.getByText(/Two calls at a time/)).toHaveTextContent(
      'up to 60 seconds; protocol tools have shorter limits'
    );
  });

  it('copies the selected client merge fragment with the observed paths and no pairing secret', async () => {
    state.executable = 'C:\\Program Files\\ProtoPeek\\protopeek.exe';
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<AgentWorkbench initialClient="opencode" />);
    expect(await screen.findByRole('combobox', { name: 'Agent client' })).toHaveValue('opencode');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Copy MCP configuration' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy MCP configuration' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(JSON.parse(writeText.mock.calls[0][0])).toEqual({
      mcp: {
        protopeek: {
          type: 'local',
          command: [state.executable, 'mcp'],
          environment: { PROTOPEEK_AGENT_CONNECTION: state.connectionFile },
          enabled: true,
        },
      },
    });
    expect(screen.getByText(/Merge into/)).toHaveTextContent('opencode.json in your project');
    expect(agentFetch).not.toHaveBeenCalledWith('control', expect.anything(), expect.anything());
    fireEvent.change(screen.getByRole('combobox', { name: 'Agent client' }), {
      target: { value: 'codex' },
    });
    expect(screen.getByLabelText('MCP configuration')).toHaveTextContent('[mcp_servers.protopeek]');
    expect(screen.getByText(/Merge into/)).toHaveTextContent('~/.codex/config.toml');
  });

  it('blocks copying when the pairing file is missing even with an explicitly chosen PATH command', async () => {
    state.connectionFile = '';
    render(<AgentWorkbench />);
    await screen.findByRole('combobox', { name: 'ProtoPeek executable' });
    fireEvent.change(screen.getByRole('combobox', { name: 'ProtoPeek executable' }), {
      target: { value: 'path' },
    });
    expect(screen.getByRole('button', { name: 'Copy MCP configuration' })).toBeDisabled();
    expect(screen.getByText(/Pairing file unavailable/)).toBeInTheDocument();
    expect(screen.queryByLabelText('MCP configuration')).not.toBeInTheDocument();
  });

  it('requires an explicit PATH choice when the running executable is unavailable', async () => {
    state.executable = '';
    render(<AgentWorkbench />);
    await screen.findByRole('combobox', { name: 'ProtoPeek executable' });
    expect(screen.getByRole('button', { name: 'Copy MCP configuration' })).toBeDisabled();
    expect(screen.getByText(/Executable unavailable/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'ProtoPeek executable' }), {
      target: { value: 'path' },
    });
    expect(screen.getByRole('button', { name: 'Copy MCP configuration' })).toBeEnabled();
    expect(screen.getByLabelText('MCP configuration')).toHaveTextContent('"command": "protopeek"');
    expect(screen.getByText(/client must resolve protopeek/)).toBeInTheDocument();
  });
});
