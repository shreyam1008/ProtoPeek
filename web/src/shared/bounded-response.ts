export async function readBoundedText(response: Response, limit: number) {
  if (!response.body) {
    const text = await response.text();
    return { text: text.slice(0, limit), truncated: text.length > limit };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let truncated = false;
  try {
    while (length < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = limit - length;
      chunks.push(value.subarray(0, remaining));
      length += Math.min(value.length, remaining);
      if (value.length > remaining) {
        truncated = true;
        break;
      }
    }
    if (length === limit && !truncated) {
      const { done } = await reader.read();
      truncated = !done;
    }
  } finally {
    if (truncated) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return { text: new TextDecoder().decode(joined), truncated };
}
