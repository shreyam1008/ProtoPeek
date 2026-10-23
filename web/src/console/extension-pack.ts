import type { FeatureRoute } from './app/feature-registry';
import type { SetupPlatform } from './extension-catalog';
export type ExtensionPack = {
  tool: string;
  download: string;
  guide: string;
  setup: Record<SetupPlatform, string>;
  afterSetup: string;
  notes: string[];
  commands?: { label: string; text: string }[];
  endpoint?: { url: string; notice: string };
  route?: FeatureRoute;
  openLabel?: string;
  diagnosticMode?: 'tls';
  client?: 'codex' | 'claude-code' | 'gemini-cli' | 'opencode' | 'lm-studio';
};
