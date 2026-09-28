import { expect, it } from 'vitest';
import { websiteTechnologyHints } from './website-technologies';

it('retains advertised technology sources without guessing an application from unrelated headers', () => {
  const result = {
    http: {
      headers: {
        Server: ['cloudflare'],
        'X-Powered-By': ['Next.js'],
        'X-Generator': ['Fixture CMS'],
        'X-AspNet-Version': ['4.0'],
        'Content-Type': ['text/html'],
        'Set-Cookie': ['session=secret'],
      },
    },
  };
  expect(websiteTechnologyHints(result)).toEqual([
    { name: 'cloudflare', category: 'Server / edge', source: 'server', advertised: 'cloudflare' },
    {
      name: 'Next.js',
      category: 'Framework / runtime',
      source: 'x-powered-by',
      advertised: 'Next.js',
    },
    {
      name: 'Fixture CMS',
      category: 'Generator',
      source: 'x-generator',
      advertised: 'Fixture CMS',
    },
    {
      name: 'ASP.NET 4.0',
      category: 'Framework / runtime',
      source: 'x-aspnet-version',
      advertised: '4.0',
    },
  ]);
  expect(
    websiteTechnologyHints({
      http: { headers: { 'Content-Type': ['text/html'] } },
    })
  ).toEqual([]);
});
