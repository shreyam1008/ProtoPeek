import { StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';

import './protopeek.css';

import { App } from './App';

type WebMCPTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input?: Record<string, unknown>) => unknown;
};

declare global {
  interface Navigator {
    modelContext?: {
      registerTool?: (tool: WebMCPTool, options?: { signal?: AbortSignal }) => Promise<void> | void;
      provideContext?: (context: { tools: WebMCPTool[] }) => Promise<void> | void;
    };
  }
}

function registerWebMCP() {
  const context = navigator.modelContext;
  if (!context?.registerTool && !context?.provideContext) return;
  const origin = window.location.origin;
  const tools: WebMCPTool[] = [
    {
      name: 'get_protopeek_release',
      description: 'Return the current stable ProtoPeek release and its GitHub release URL.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: () => ({
        version: '0.6.1',
        url: 'https://github.com/shreyam1008/ProtoPeek/releases/tag/v0.6.1',
      }),
    },
    {
      name: 'open_protopeek_resource',
      description: 'Open a public ProtoPeek guide or machine-readable discovery resource.',
      inputSchema: {
        type: 'object',
        properties: {
          resource: {
            type: 'string',
            enum: ['docs', 'install', 'aiAgents', 'llms', 'skills', 'apiCatalog', 'openapi'],
          },
        },
        required: ['resource'],
        additionalProperties: false,
      },
      execute: (input = {}) => {
        const paths: Record<string, string> = {
          docs: '/docs/',
          install: '/install/',
          aiAgents: '/ai-agents/',
          llms: '/llms.txt',
          skills: '/.well-known/agent-skills/index.json',
          apiCatalog: '/.well-known/api-catalog',
          openapi: '/openapi.json',
        };
        const url = origin + (paths[String(input.resource || 'docs')] || paths.docs);
        window.open(url, '_blank', 'noopener,noreferrer');
        return { url };
      },
    },
  ];
  const registerTool = context.registerTool;
  if (registerTool) {
    const controller = new AbortController();
    window.addEventListener('pagehide', () => controller.abort(), { once: true });
    tools.forEach((tool) => {
      try {
        void registerTool(tool, { signal: controller.signal });
      } catch {
        /* feature detection race */
      }
    });
  }
  if (context.provideContext) void context.provideContext({ tools });
}

window.setTimeout(registerWebMCP, 0);

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('ProtoPeek site root element not found.');
}

hydrateRoot(
  rootElement,
  <StrictMode>
    <App />
  </StrictMode>
);
