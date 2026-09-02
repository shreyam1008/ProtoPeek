export function formatDecimalBytes(value: string) {
  const bytes = BigInt(value);
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
  let unit = 0;
  let divisor = BigInt(1);
  while (bytes >= BigInt(1000) * divisor && unit < units.length - 1) {
    divisor *= BigInt(1000);
    unit += 1;
  }
  if (unit === 0) return `${bytes.toString()} B`;
  const tenths = (bytes * BigInt(10)) / divisor;
  return `${(tenths / BigInt(10)).toString()}.${(tenths % BigInt(10)).toString()} ${units[unit]}`;
}

export function formatPayloadBytes(value: number) {
  return `${value.toLocaleString('en-US')} bytes (${(value / 1_000_000).toFixed(1)} MB)`;
}

export function formatObservedAt(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(value));
}

export function formatRate(value?: number) {
  if (value === undefined) return 'Not measured';
  return `${(value / 1_000_000).toFixed(value >= 100_000_000 ? 0 : 1)} Mbps`;
}

export function formatMilliseconds(value?: number) {
  if (value === undefined) return 'Not measured';
  return `${value.toFixed(value >= 100 ? 0 : 1)} ms`;
}

export function formatAverageBitRate(bytes: string, durationMs: number) {
  const bitsPerSecond = (BigInt(bytes) * BigInt(8000)) / BigInt(durationMs);
  if (bitsPerSecond < BigInt(1_000_000)) {
    return `${(Number(bitsPerSecond) / 1000).toFixed(1)} Kbps average`;
  }
  const tenths = (bitsPerSecond * BigInt(10)) / BigInt(1_000_000);
  return `${(tenths / BigInt(10)).toString()}.${(tenths % BigInt(10)).toString()} Mbps average`;
}
