import type { WebsiteObservationResult } from './security-api';

export type WebsiteTechnologyHint = {
  name: string;
  category: 'Server / edge' | 'Framework / runtime' | 'Generator' | 'Proxy';
  source: string;
  advertised: string;
};

const technologyHeaders = [
  ['server', 'Server / edge'],
  ['x-powered-by', 'Framework / runtime'],
  ['x-generator', 'Generator'],
  ['x-aspnet-version', 'Framework / runtime'],
  ['x-aspnetmvc-version', 'Framework / runtime'],
  ['via', 'Proxy'],
] as const;

// These are disclosures in one response, never verified framework detection.
export function websiteTechnologyHints(result: {
  http: Pick<WebsiteObservationResult['http'], 'headers'>;
}): WebsiteTechnologyHint[] {
  const headers = new Map(
    Object.entries(result.http.headers).map(([name, values]) => [name.toLowerCase(), values])
  );
  return technologyHeaders.flatMap(([source, category]) =>
    (headers.get(source) ?? [])
      .filter((value) => value.trim())
      .map((value) => {
        const advertised = value.replace(/\s+/g, ' ').trim().slice(0, 256);
        return {
          source,
          category,
          advertised,
          name:
            source === 'x-aspnet-version'
              ? `ASP.NET ${advertised}`
              : source === 'x-aspnetmvc-version'
                ? `ASP.NET MVC ${advertised}`
                : advertised,
        };
      })
  );
}
