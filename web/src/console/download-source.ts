export function safeSourceLabel(source: string) {
  if (!source) return 'Source hidden until the engine reports it.';
  try {
    const url = new URL(source);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return 'Source hidden because the engine returned an unsupported URL.';
    }
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return 'Source hidden because the engine returned an invalid URL.';
  }
}

// Transport and extractor errors can quote the full source URL. Keep host retry
// state intact and redact these URLs only when presenting the message.
export function safeDownloadMessage(message: string) {
  return message.replace(/https?:\/\/[^\s"'<>]+/gi, (source) => safeSourceLabel(source));
}
