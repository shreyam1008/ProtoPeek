import { sendHTTPRequest } from './api';
import type { OpenAPICollection } from './openapi';
import { discoverOpenAPISpecURL, parseOpenAPIText } from './openapi';

async function fetchOpenAPIDocument(target: string, signal: AbortSignal) {
  const response = await sendHTTPRequest(
    {
      method: 'GET',
      url: target,
      headers: [
        {
          name: 'Accept',
          value: 'application/json, application/vnd.oai.openapi+json, text/html;q=0.7',
        },
      ],
      body: '',
      timeoutMs: 15_000,
      followRedirects: true,
    },
    signal
  );
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Definition request returned ${response.status}.`);
  }
  if (response.truncated) throw new Error('Definition response exceeds the 4 MiB relay limit.');
  if (response.bodyEncoding !== 'text') {
    throw new Error('Definition response is not textual JSON.');
  }
  return response.body;
}

export async function importOpenAPIFromURL(
  target: string,
  signal: AbortSignal
): Promise<OpenAPICollection> {
  let source = target;
  let document = await fetchOpenAPIDocument(target, signal);
  if (/^\s*</.test(document)) {
    const definitionURL = discoverOpenAPISpecURL(document, target);
    if (!definitionURL) {
      throw new Error(
        'Docs page did not expose a linked definition. Paste its direct openapi.json or swagger.json URL.'
      );
    }
    source = definitionURL;
    document = await fetchOpenAPIDocument(definitionURL, signal);
  }
  return parseOpenAPIText(document, source);
}

export async function importOpenAPIFromFile(file: File): Promise<OpenAPICollection> {
  return parseOpenAPIText(await file.text(), file.name);
}
