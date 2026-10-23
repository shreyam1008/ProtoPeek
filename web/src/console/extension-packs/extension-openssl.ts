import type { ExtensionPack } from '../extension-pack';

const extension = {
  tool: 'openssl',
  download: 'https://openssl-library.org/source/',
  guide: 'https://docs.openssl.org/master/man1/openssl-s_client/',
  setup: {
    windows:
      "Choose a trusted Windows build or follow OpenSSL's build notes; this link is not a universal binary installer.",
    darwin:
      "Use a supported OpenSSL package; the platform's similarly named tool can be a different TLS implementation.",
    linux: "Use your distribution's supported OpenSSL command-line package.",
  },
  afterSetup:
    'Use built-in TLS diagnostics for the normal service check. Native OpenSSL offers a separate comparison with its own trust store and network context.',
  notes: [
    'Commands are static examples to review and run yourself; ProtoPeek does not execute them.',
    'Verification stays enabled. This guide does not install certificates or change trust stores.',
  ],
  commands: [
    {
      label: 'Read the native version',
      text: 'openssl version',
    },
    {
      label: 'Example: verified TLS comparison',
      text: 'openssl s_client -connect example.com:443 -servername example.com -verify_hostname example.com -verify_return_error',
    },
  ],
  route: '/network/diagnostics',
  openLabel: 'Open TLS diagnostics',
  diagnosticMode: 'tls',
} satisfies ExtensionPack;

export default extension;
