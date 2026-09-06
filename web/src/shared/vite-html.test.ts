import { describe, expect, it } from 'vitest';
import { normalizeHTMLInput } from '../../vite.html';

describe('HTML build input normalization', () => {
  it('runs before Vite transforms module script tags', () => {
    expect(normalizeHTMLInput.transformIndexHtml.order).toBe('pre');
  });

  it('gives mixed, Windows, and Unix sources the same input', () => {
    const html =
      '<body>\n  <div id="root"></div>\n  <script type="module" src="./main.tsx"></script>\n</body>\n';
    const normalize = normalizeHTMLInput.transformIndexHtml.handler;
    expect(normalize(html)).toBe(html);
    expect(normalize(html.replaceAll('\n', '\r\n'))).toBe(html);
    expect(
      normalize(html.replace('<body>\n', '<body>\r\n').replace('</body>\n', '</body>\r'))
    ).toBe(html);
  });
});
