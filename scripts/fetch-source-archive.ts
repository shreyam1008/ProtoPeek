// Build-time downloads must preserve the publisher's archive bytes for SHA-256.
export async function fetchSourceArchive(url: string): Promise<Uint8Array> {
  const response = await fetch(url, {
    headers: { 'Accept-Encoding': 'identity' },
    // Some archive hosts label the .gz file itself as Content-Encoding: gzip.
    // Fetch's automatic decoding would silently change the published artifact.
    decompress: false,
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`source archive: HTTP ${response.status}`);
  if (!response.body) throw new Error('source archive: empty response');
  const parts: Uint8Array[] = [];
  let length = 0;
  for await (const part of response.body) {
    length += part.length;
    if (length > 32 * 1024 * 1024) throw new Error('source archive exceeds 32 MiB');
    parts.push(part);
  }
  return Buffer.concat(parts);
}
