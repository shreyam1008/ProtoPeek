import type { ExtensionPack } from '../extension-pack';

const extension = {
  tool: 'nmap',
  download: 'https://nmap.org/download.html',
  guide: 'https://nmap.org/book/install.html',
  setup: {
    windows: 'Install Nmap and add its CLI to PATH.',
    darwin: 'Install Nmap for macOS and add it to PATH.',
    linux: 'Install the nmap package.',
  },
  afterSetup:
    'Review the target before scanning. The built-in TCP scanner and XML import also work alone.',
  notes: [
    'Review the authorized target, ports and bounded plan before starting a scan.',
    'Offline XML import needs no Nmap installation and does not verify a hinted protocol.',
  ],
} satisfies ExtensionPack;

export default extension;
