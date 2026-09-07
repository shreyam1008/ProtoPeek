export type PortResult = {
  port: number;
  state: 'open' | 'closed' | 'no-response' | 'unreachable' | 'not-scanned';
  durationMs: number;
};
export type PortScanResponse = {
  host: string;
  address: string;
  results: PortResult[];
  durationMs: number;
  complete: boolean;
};
export const portPresets = {
  common:
    '22,25,53,80,110,139,143,443,445,465,587,993,995,1433,3306,3389,5432,5900,6379,8000,8080,8443,9090,9200,27017,50051',
  development:
    '3000,3001,4000,4200,5000,5173,5432,6379,7000,8000,8080,8081,8443,8844,9000,9090,50051',
};
const services: Record<number, string> = {
  22: 'SSH',
  25: 'SMTP',
  53: 'DNS',
  80: 'HTTP',
  110: 'POP3',
  139: 'NetBIOS',
  143: 'IMAP',
  443: 'HTTPS',
  445: 'SMB',
  465: 'SMTP over TLS',
  587: 'Mail submission',
  993: 'IMAP over TLS',
  995: 'POP3 over TLS',
  1433: 'SQL Server',
  3306: 'MySQL',
  3389: 'Remote Desktop',
  5432: 'PostgreSQL',
  5900: 'VNC',
  6379: 'Redis',
  8000: 'HTTP development',
  8080: 'HTTP alternative',
  8443: 'HTTPS alternative',
  9090: 'HTTP / metrics',
  9200: 'Elasticsearch',
  27017: 'MongoDB',
  50051: 'gRPC convention',
};
export function serviceHint(port: number) {
  return services[port] ?? 'Unknown';
}
export function previewPorts(value: string): number[] {
  if (!value.trim() || value.length > 8192)
    throw new Error('Enter comma-separated ports or ranges.');
  const ports = new Set<number>();
  for (const item of value.split(',')) {
    const match = item.trim().match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if (!match) throw new Error('Use ports or ranges, such as 80,443,8000-8010.');
    const first = Number(match[1]);
    const last = Number(match[2] ?? first);
    if (first < 1 || last > 65535 || last < first)
      throw new Error('Ports must be 1–65535, with ranges in ascending order.');
    if (last - first + 1 > 1024) throw new Error('Choose at most 1024 ports per scan.');
    for (let port = first; port <= last; port++) {
      ports.add(port);
      if (ports.size > 1024) throw new Error('Choose at most 1024 ports per scan.');
    }
  }
  return [...ports].sort((a, b) => a - b);
}
