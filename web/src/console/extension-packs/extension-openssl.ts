import type { ExtensionPack } from '../extension-pack';

const extension = {
  tool: 'openssl',
  download: 'https://openssl-library.org/source/',
  guide: 'https://docs.openssl.org/master/man1/openssl-s_client/',
  setup: {
    windows: 'Use a trusted Windows build or compile from source.',
    darwin: 'Check whether openssl is LibreSSL or OpenSSL.',
    linux: 'Install the OpenSSL command-line package.',
  },
  afterSetup: 'Compare the service with TLS diagnostics. OpenSSL uses its own trust store.',
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
