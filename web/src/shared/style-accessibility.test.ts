import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const consoleCSS = readFileSync(
  path.resolve(process.cwd(), 'web/src/shared/protopeek.css'),
  'utf8'
);
const docsCSS = readFileSync(path.resolve(process.cwd(), 'web/site/public/docs.css'), 'utf8');

function colorFrom(block: string, token: string) {
  const match = block.match(new RegExp(`${token}:\\s*(#[0-9a-f]{6})`, 'i'));
  if (!match?.[1]) throw new Error(`Missing ${token} color token.`);
  return match[1];
}

function luminance(hex: string) {
  const channels = [1, 3, 5].map(
    (offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
  );
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return ((values[0] ?? 0) + 0.05) / ((values[1] ?? 0) + 0.05);
}

function themeBlock(selector: string) {
  const start = consoleCSS.indexOf(selector);
  const end = consoleCSS.indexOf('\n}', start);
  if (start < 0 || end < 0) throw new Error(`Missing ${selector} theme block.`);
  return consoleCSS.slice(start, end);
}

describe('published color and motion contracts', () => {
  it('keeps faint console text readable on every console surface in both themes', () => {
    for (const block of [
      themeBlock(':root,\n:root[data-theme="light"]'),
      themeBlock(':root[data-theme="dark"]'),
    ]) {
      const faint = colorFrom(block, '--pp-text-faint');
      for (const surface of [
        '--pp-canvas',
        '--pp-surface',
        '--pp-surface-raised',
        '--pp-surface-sunken',
      ]) {
        expect(
          contrastRatio(faint, colorFrom(block, surface)),
          `${faint} on ${surface}`
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps supporting docs text readable on its light surfaces', () => {
    const root = docsCSS.slice(
      docsCSS.indexOf(':root'),
      docsCSS.indexOf('\n}', docsCSS.indexOf(':root'))
    );
    const muted = colorFrom(root, '--pp-muted');
    expect(contrastRatio(muted, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(muted, '#f2f8f7')).toBeGreaterThanOrEqual(4.5);
  });

  it('stops decorative docs animation when reduced motion is requested', () => {
    const reducedMotion = docsCSS.match(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/
    )?.[1];
    expect(reducedMotion).toContain('.pp-doc-orb');
    expect(reducedMotion).toContain('.pp-doc-visual-card path');
    expect(reducedMotion).toContain('.pp-doc-visual-card circle');
    expect(reducedMotion).toContain('.pp-doc-visual-fill');
    expect(reducedMotion).toMatch(/animation:\s*none/);
  });
});
