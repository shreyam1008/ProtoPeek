export const agentClientIds = [
  'codex',
  'claude-code',
  'gemini-cli',
  'opencode',
  'lm-studio',
  'generic',
] as const;

export type AgentClient = (typeof agentClientIds)[number];

export function agentClient(value: unknown): AgentClient | undefined {
  return typeof value === 'string' && agentClientIds.includes(value as AgentClient)
    ? (value as AgentClient)
    : undefined;
}
