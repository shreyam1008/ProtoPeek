import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const consoleCSS = readFileSync(
  path.resolve(process.cwd(), 'web/src/shared/protopeek.css'),
  'utf8'
).replaceAll('\r\n', '\n');
const tokenCSS = readFileSync(
  path.resolve(process.cwd(), 'web/src/design/tokens.css'),
  'utf8'
).replaceAll('\r\n', '\n');
const themeCSS = readFileSync(
  path.resolve(process.cwd(), 'web/src/design/themes.css'),
  'utf8'
).replaceAll('\r\n', '\n');
const docsCSS = readFileSync(
  path.resolve(process.cwd(), 'web/site/public/docs.css'),
  'utf8'
).replaceAll('\r\n', '\n');

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

function mixHex(foreground: string, background: string, foregroundWeight: number) {
  const mixed = [1, 3, 5].map((offset) => {
    const front = Number.parseInt(foreground.slice(offset, offset + 2), 16);
    const back = Number.parseInt(background.slice(offset, offset + 2), 16);
    return Math.round(front * foregroundWeight + back * (1 - foregroundWeight));
  });
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function themeBlock(selector: string) {
  const start = themeCSS.indexOf(selector);
  const end = themeCSS.indexOf('\n}', start);
  if (start < 0 || end < 0) throw new Error(`Missing ${selector} theme block.`);
  return themeCSS.slice(start, end);
}

function colorsFrom(block: string) {
  return Object.fromEntries(
    [...block.matchAll(/(--pp-color-[\w-]+):\s*(#[0-9a-f]{6})/gi)].map((match) => [
      match[1],
      match[2],
    ])
  );
}

function paletteColors(palette: string, mode: 'light' | 'dark') {
  const colors = colorsFrom(themeBlock(':root {\n  --pp-color-canvas'));
  if (mode === 'dark') {
    Object.assign(
      colors,
      colorsFrom(themeBlock(':root[data-theme="dark"] {\n  --pp-color-canvas'))
    );
  }
  if (palette === 'protopeek') return colors;
  Object.assign(colors, colorsFrom(themeBlock(`:root[data-palette="${palette}"]`)));
  if (mode === 'dark') {
    Object.assign(
      colors,
      colorsFrom(themeBlock(`:root[data-palette="${palette}"][data-theme="dark"]`))
    );
  }
  return colors;
}

function selectorBlockAfter(startMarker: string, selector: string) {
  const start = consoleCSS.indexOf(startMarker);
  if (start < 0) throw new Error(`Missing ${startMarker}.`);
  const selectorStart = consoleCSS.indexOf(selector, start);
  const declarationStart = consoleCSS.indexOf('{', selectorStart);
  const end = consoleCSS.indexOf('\n  }', declarationStart);
  if (selectorStart < 0 || declarationStart < 0 || end < 0) {
    throw new Error(`Missing ${selector} block after ${startMarker}.`);
  }
  return consoleCSS.slice(declarationStart + 1, end);
}

const palettes = ['protopeek', 'graphite', 'nord', 'solarized', 'high-contrast'] as const;
const surfaceTokens = [
  '--pp-color-canvas',
  '--pp-color-chrome',
  '--pp-color-surface',
  '--pp-color-surface-raised',
  '--pp-color-surface-sunken',
  '--pp-color-code-surface',
  '--pp-color-code-surface-raised',
] as const;

describe('published color and motion contracts', () => {
  it('keeps ordinary text readable on every surface in every paired palette', () => {
    const textTokens = ['--pp-color-text', '--pp-color-text-muted', '--pp-color-text-faint'];

    for (const palette of palettes) {
      for (const mode of ['light', 'dark'] as const) {
        const colors = paletteColors(palette, mode);
        for (const text of textTokens) {
          for (const surface of surfaceTokens) {
            const foreground = colors[text];
            const background = colors[surface];
            if (!foreground || !background) throw new Error(`Missing ${palette} ${mode} token.`);
            expect
              .soft(
                contrastRatio(foreground, background),
                `${palette} ${mode}: ${text} ${foreground} on ${surface} ${background}`
              )
              .toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    }
  });

  it('defines explicit reduced-motion and forced-color fallbacks', () => {
    const reducedMotion = tokenCSS.match(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/
    )?.[1];
    expect(reducedMotion).toContain('--pp-motion-fast: 0ms');
    expect(reducedMotion).toContain('--pp-motion-standard: 0ms');
    expect(reducedMotion).toContain('--pp-motion-slow: 0ms');

    const forcedColors = themeCSS.match(
      /@media\s*\(forced-colors:\s*active\)\s*\{([\s\S]*?)\n\}/
    )?.[1];
    for (const systemColor of ['Canvas', 'CanvasText', 'Highlight', 'HighlightText', 'LinkText']) {
      expect(forcedColors).toContain(systemColor);
    }
    expect(forcedColors).toContain('--pp-shadow-menu: none');
    expect(forcedColors).toContain('--pp-shadow-dialog: none');
  });

  it('stops active shared loaders when reduced motion is requested', () => {
    const reducedMotion = [
      ...consoleCSS.matchAll(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/g),
    ]
      .map((match) => match[1])
      .join('\n');

    for (const selector of [
      '.pp-response-spinner',
      '.pp-scan-progress svg',
      '.pp-evidence-loading svg',
      '.pp-nmap-port button svg.is-loading',
    ]) {
      expect(reducedMotion).toContain(selector);
    }
    expect(reducedMotion).toMatch(/animation:\s*none/);
  });

  it('keeps the canonical focus ring theme-aware', () => {
    expect(consoleCSS).toMatch(
      /:focus-visible\s*\{[^}]*outline:\s*var\(--pp-focus-width\) solid var\(--pp-color-focus\)/s
    );
    expect(consoleCSS).toMatch(/outline-offset:\s*var\(--pp-focus-offset\)/);
  });

  it('keeps palette accents distinguishable from their common surfaces', () => {
    for (const palette of palettes) {
      for (const mode of ['light', 'dark'] as const) {
        const colors = paletteColors(palette, mode);
        for (const surface of surfaceTokens) {
          const accent = colors['--pp-color-accent'];
          const background = colors[surface];
          if (!accent || !background) throw new Error(`Missing ${palette} ${mode} focus token.`);
          expect
            .soft(
              contrastRatio(accent, background),
              `${palette} ${mode}: accent ${accent} on ${surface} ${background}`
            )
            .toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('keeps strong boundaries visible and inverse labels readable in every palette pair', () => {
    for (const palette of palettes) {
      for (const mode of ['light', 'dark'] as const) {
        const colors = paletteColors(palette, mode);
        const strongStroke = colors['--pp-color-stroke-strong'];
        const inverse = colors['--pp-color-text-inverse'];
        const accent = colors['--pp-color-accent'];
        if (!strongStroke || !inverse || !accent) {
          throw new Error(`Missing ${palette} ${mode} boundary token.`);
        }
        for (const surface of surfaceTokens) {
          const background = colors[surface];
          if (!background) throw new Error(`Missing ${palette} ${mode} ${surface}.`);
          expect
            .soft(
              contrastRatio(strongStroke, background),
              `${palette} ${mode}: strong stroke ${strongStroke} on ${surface} ${background}`
            )
            .toBeGreaterThanOrEqual(3);
        }
        expect
          .soft(
            contrastRatio(inverse, accent),
            `${palette} ${mode}: inverse ${inverse} on accent ${accent}`
          )
          .toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps status text and evidence boundaries legible on semantic fills', () => {
    for (const status of ['success', 'warning', 'danger', 'info']) {
      expect(themeCSS).toMatch(
        new RegExp(
          `--pp-color-${status}-border:\\s*color-mix\\(\\s*in srgb,\\s*var\\(--pp-color-${status}\\) 76%,\\s*var\\(--pp-color-stroke\\)\\s*\\)`
        )
      );
    }
    for (const palette of palettes) {
      for (const mode of ['light', 'dark'] as const) {
        const colors = paletteColors(palette, mode);
        const stroke = colors['--pp-color-stroke'];
        if (!stroke) throw new Error(`Missing ${palette} ${mode} status stroke.`);
        for (const status of ['success', 'warning', 'danger', 'info']) {
          const foreground = colors[`--pp-color-${status}`];
          if (!foreground) throw new Error(`Missing ${mode} ${status} token.`);
          const statusBorder = mixHex(foreground, stroke, 0.76);
          for (const surfaceToken of surfaceTokens) {
            const surface = colors[surfaceToken];
            if (!surface) throw new Error(`Missing ${palette} ${mode} ${surfaceToken}.`);
            const softFill = mixHex(foreground, surface, 0.12);
            expect
              .soft(
                contrastRatio(foreground, softFill),
                `${palette} ${mode}: ${status} ${foreground} on ${surfaceToken} soft fill ${softFill}`
              )
              .toBeGreaterThanOrEqual(4.5);
            expect
              .soft(
                contrastRatio(statusBorder, surface),
                `${palette} ${mode}: ${status} border ${statusBorder} on ${surfaceToken} ${surface}`
              )
              .toBeGreaterThanOrEqual(3);
          }
        }
      }
    }
  });

  it('uses the stronger palette accent for code text', () => {
    expect(themeCSS).toMatch(/--pp-color-code-accent:\s*var\(--pp-color-accent-strong\)/);
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

  it('keeps the narrow HTTP pane switch on theme-aware surfaces', () => {
    const mobileTabs = selectorBlockAfter('@media (max-width: 760px)', '.pp-http-mobile-tabs');

    expect(mobileTabs).toMatch(/background:\s*var\(--pp-chrome\)/);
    expect(mobileTabs).toMatch(/border-bottom:\s*1px solid var\(--pp-stroke\)/);
  });

  it('hides the inactive HTTP pane across the full 760px mobile-tab range', () => {
    const hiddenPane = selectorBlockAfter('@media (max-width: 760px)', '.pp-mobile-pane-hidden');

    expect(hiddenPane).toMatch(/display:\s*none/);
  });
});
