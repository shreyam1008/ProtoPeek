import type { ExtensionPack } from '../extension-pack';

const extension = {
  tool: 'ssh client',
  download: 'https://www.openssh.org/portable.html',
  guide:
    'https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse',
  setup: {
    windows:
      "Use Windows' OpenSSH Client optional feature. A local forward does not require OpenSSH Server.",
    darwin: 'Use the macOS ssh client or a supported OpenSSH package.',
    linux:
      "Install your distribution's OpenSSH client; a local forward does not need a local SSH server.",
  },
  afterSetup:
    'Replace the example account and destination in your terminal. You own authentication and the forward; inspect its actual local port after it starts listening.',
  notes: [
    "The example binds only 127.0.0.1 and reaches the remote account's loopback service; those are different machines.",
    'This guide does not read keys, passwords or SSH configuration, or create a tunnel.',
  ],
  commands: [
    {
      label: 'Example: local-only HTTP forward',
      text: 'ssh -N -L 127.0.0.1:8080:127.0.0.1:8080 user@example.test',
    },
  ],
  endpoint: {
    url: 'http://127.0.0.1:8080/',
    notice:
      'Example forwarded port. Start your authorized SSH forward separately and confirm its real local port before Send.',
  },
} satisfies ExtensionPack;

export default extension;
