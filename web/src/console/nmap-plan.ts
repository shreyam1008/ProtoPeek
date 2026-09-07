import { previewPorts } from './port-scan';

// A local preview only. The Go handler validates the same limits before execution.
export function previewNmapPlan(targetInput: string, portsInput: string) {
  const ports = previewPorts(portsInput);
  let target = targetInput.trim();
  let hosts = 1;
  if (target.includes(':')) {
    if (!/^[0-9a-fA-F:.]+$/.test(target)) throw new Error('Enter a literal unscoped IPv6 address.');
    let hostname = '';
    try {
      hostname = new URL(`http://[${target}]/`).hostname;
    } catch {
      throw new Error('Enter a literal IPv4 or unscoped IPv6 address.');
    }
    if (!hostname.startsWith('[') || target.includes('%'))
      throw new Error('Enter an unscoped IPv6 address.');
    target = hostname.slice(1, -1);
    if (target === '::' || /^ff/i.test(target) || /^fe[89ab]/i.test(target))
      throw new Error('Choose an unscoped unicast IP address.');
  } else {
    const match = target.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)(?:\/(\d+))?$/);
    if (!match) throw new Error('Enter one literal IP or a private IPv4 /24-or-smaller subnet.');
    const octets = match.slice(1, 5).map(Number);
    if (
      octets.some((part) => part > 255) ||
      match.slice(1, 5).some((part) => part.length > 1 && part.startsWith('0'))
    )
      throw new Error('Enter a valid IPv4 address without leading zeros.');
    const [a, b] = octets;
    if (match[5] !== undefined) {
      const prefix = Number(match[5]);
      if (
        prefix < 24 ||
        prefix > 32 ||
        !(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))
      )
        throw new Error('Choose a private IPv4 /24-or-smaller subnet.');
      hosts = 2 ** (32 - prefix);
      octets[3] = Math.floor(octets[3] / hosts) * hosts;
      target = `${octets.join('.')}/${prefix}`;
    } else if (target === '0.0.0.0' || (a >= 224 && a <= 239) || (a === 169 && b === 254)) {
      throw new Error('Choose an unscoped unicast IP address.');
    }
  }
  const pairs = hosts * ports.length;
  if (pairs > 4096)
    throw new Error(
      'Limit the plan to 4,096 host-port pairs; choose a smaller subnet or fewer ports.'
    );
  return { target, hosts, ports, pairs };
}
