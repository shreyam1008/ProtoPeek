import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

import {
  type AppearancePreference,
  appearanceStorageKey,
  applyAppearance,
  applyTheme,
  defaultAppearancePreference,
  parseAppearancePreference,
  persistAppearancePreference,
  persistThemePreference,
  readAppearancePreference,
  readThemePreference,
  resolveAppearance,
  resolveAppearanceTheme,
  themeStorageKey,
} from './theme';

type StorageOptions = {
  denyRead?: boolean;
  denyWrite?: boolean;
};

function createStorage(initial: Record<string, string> = {}, options: StorageOptions = {}) {
  const values = new Map(Object.entries(initial));
  const reads: string[] = [];
  return {
    storage: {
      getItem(key: string) {
        reads.push(key);
        if (options.denyRead) throw new DOMException('denied', 'SecurityError');
        return values.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        if (options.denyWrite) throw new DOMException('denied', 'SecurityError');
        values.set(key, value);
      },
    },
    peek: (key: string) => values.get(key) ?? null,
    reads,
  };
}

const consoleHtml = readFileSync(`${process.cwd()}/web/console/index.html`, 'utf8');
function requireBootstrapSource(html: string) {
  const source = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!source) throw new Error('appearance bootstrap script not found');
  return source;
}
const bootstrapSource = requireBootstrapSource(consoleHtml);

type BootstrapOptions = StorageOptions & {
  initial?: Record<string, string>;
  prefersDark?: boolean;
};

function runBootstrap({ initial = {}, prefersDark = false, ...options }: BootstrapOptions = {}) {
  const storage = createStorage(initial, options);
  const dataset: Record<string, string> = {};
  const mediaQueries: string[] = [];
  runInNewContext(bootstrapSource, {
    document: { documentElement: { dataset } },
    localStorage: storage.storage,
    matchMedia(query: string) {
      mediaQueries.push(query);
      return { matches: prefersDark };
    },
  });
  return { ...storage, dataset, mediaQueries };
}

const v2 = (mode: AppearancePreference['mode'], palette: AppearancePreference['palette']) =>
  JSON.stringify({ version: 2, mode, palette });
const v1 = (theme: 'light' | 'dark') => JSON.stringify({ version: 1, theme });

describe('appearance preference', () => {
  it.each([
    ['system resolves light', 'system', false, 'light'],
    ['system resolves dark', 'system', true, 'dark'],
    ['explicit light ignores a dark system', 'light', true, 'light'],
    ['explicit dark ignores a light system', 'dark', false, 'dark'],
  ] as const)('%s', (_name, mode, prefersDark, expected) => {
    expect(resolveAppearanceTheme(mode, prefersDark)).toBe(expected);
  });

  it('resolves without mutating the preference', () => {
    const preference = Object.freeze({ version: 2, mode: 'system', palette: 'nord' } as const);
    expect(resolveAppearance(preference, true)).toEqual({ ...preference, theme: 'dark' });
    expect(preference).toEqual({ version: 2, mode: 'system', palette: 'nord' });
  });

  it.each([
    ['wrong version', { version: 1, mode: 'dark', palette: 'graphite' }],
    ['unknown mode', { version: 2, mode: 'auto', palette: 'graphite' }],
    ['wrong mode case', { version: 2, mode: 'Dark', palette: 'graphite' }],
    ['unknown palette', { version: 2, mode: 'dark', palette: 'sepia' }],
    ['wrong palette case', { version: 2, mode: 'dark', palette: 'Graphite' }],
    ['array value', [{ version: 2, mode: 'dark', palette: 'graphite' }]],
    ['null value', null],
  ])('rejects a %s', (_name, value) => {
    expect(parseAppearancePreference(value)).toBeNull();
  });

  it.each([
    ['protopeek', 'protopeek'],
    ['graphite', 'graphite'],
    ['nord', 'nord'],
    ['solarized', 'solarized'],
    ['high contrast', 'high-contrast'],
  ] as const)('accepts the %s palette', (_name, palette) => {
    expect(parseAppearancePreference({ version: 2, mode: 'system', palette })).toEqual({
      version: 2,
      mode: 'system',
      palette,
    });
  });

  it('gives a valid v2 preference precedence without reading or rewriting v1', () => {
    const current = v2('system', 'nord');
    const legacy = v1('dark');
    const storage = createStorage({
      [appearanceStorageKey]: current,
      [themeStorageKey]: legacy,
    });

    expect(readAppearancePreference(storage.storage)).toEqual({
      version: 2,
      mode: 'system',
      palette: 'nord',
    });
    expect(storage.reads).toEqual([appearanceStorageKey]);
    expect(storage.peek(appearanceStorageKey)).toBe(current);
    expect(storage.peek(themeStorageKey)).toBe(legacy);
  });

  it.each([
    'light',
    'dark',
  ] as const)('migrates v1 %s while preserving the rollback key', (theme) => {
    const legacy = v1(theme);
    const storage = createStorage({ [themeStorageKey]: legacy });

    expect(readAppearancePreference(storage.storage)).toEqual({
      version: 2,
      mode: theme,
      palette: 'graphite',
    });
    expect(storage.peek(appearanceStorageKey)).toBe(v2(theme, 'graphite'));
    expect(storage.peek(themeStorageKey)).toBe(legacy);
  });

  it.each([
    ['missing values', {}],
    ['malformed values', { [appearanceStorageKey]: '{', [themeStorageKey]: '{' }],
    [
      'invalid allowlisted values',
      {
        [appearanceStorageKey]: v2('dark', 'graphite').replace('graphite', 'Graphite'),
        [themeStorageKey]: JSON.stringify({ version: 1, theme: 'system' }),
      },
    ],
  ])('falls back to system + graphite for %s', (_name, initial) => {
    const storage = createStorage(initial);
    const preference = readAppearancePreference(storage.storage);
    expect(preference).toEqual(defaultAppearancePreference);
    expect(preference).not.toBe(defaultAppearancePreference);
  });

  it('falls back when storage reads are denied and tolerates denied writes', () => {
    const deniedRead = createStorage(
      { [appearanceStorageKey]: v2('dark', 'nord') },
      { denyRead: true }
    );
    expect(readAppearancePreference(deniedRead.storage)).toEqual(defaultAppearancePreference);

    const deniedWrite = createStorage({}, { denyWrite: true });
    const preference: AppearancePreference = { version: 2, mode: 'dark', palette: 'solarized' };
    expect(() => persistAppearancePreference(preference, deniedWrite.storage)).not.toThrow();
    expect(deniedWrite.peek(appearanceStorageKey)).toBeNull();
  });

  it('applies resolved mode, selected mode, and palette together', () => {
    applyAppearance(
      { version: 2, mode: 'system', palette: 'high-contrast' },
      true,
      document.documentElement
    );
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(document.documentElement).toHaveAttribute('data-theme-mode', 'system');
    expect(document.documentElement).toHaveAttribute('data-palette', 'high-contrast');
  });

  it('keeps the v1 compatibility helpers backed by the v2 preference', () => {
    const storage = createStorage();
    expect(readThemePreference(null)).toBe('light');
    persistThemePreference('dark', storage.storage);
    expect(storage.peek(appearanceStorageKey)).toBe(v2('dark', 'graphite'));
    expect(storage.peek(themeStorageKey)).toBeNull();

    applyTheme('light', document.documentElement);
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(document.documentElement).toHaveAttribute('data-theme-mode', 'light');
  });
});

describe('prepaint appearance bootstrap', () => {
  const cases: Array<{
    name: string;
    initial?: Record<string, string>;
    options?: StorageOptions;
    prefersDark: boolean;
    expected: AppearancePreference & { theme: 'light' | 'dark' };
  }> = [
    {
      name: 'valid v2 wins over conflicting v1',
      initial: {
        [appearanceStorageKey]: v2('system', 'nord'),
        [themeStorageKey]: v1('dark'),
      },
      prefersDark: false,
      expected: { version: 2, mode: 'system', palette: 'nord', theme: 'light' },
    },
    {
      name: 'missing preference follows a dark system',
      prefersDark: true,
      expected: { version: 2, mode: 'system', palette: 'graphite', theme: 'dark' },
    },
    {
      name: 'malformed v2 migrates valid legacy light',
      initial: { [appearanceStorageKey]: '{', [themeStorageKey]: v1('light') },
      prefersDark: true,
      expected: { version: 2, mode: 'light', palette: 'graphite', theme: 'light' },
    },
    {
      name: 'invalid v2 and v1 use the default',
      initial: {
        [appearanceStorageKey]: JSON.stringify({
          version: 2,
          mode: 'auto',
          palette: 'Graphite',
        }),
        [themeStorageKey]: JSON.stringify({ version: 1, theme: 'system' }),
      },
      prefersDark: false,
      expected: { version: 2, mode: 'system', palette: 'graphite', theme: 'light' },
    },
    {
      name: 'denied read uses the live system fallback',
      initial: { [appearanceStorageKey]: v2('light', 'protopeek') },
      options: { denyRead: true },
      prefersDark: true,
      expected: { version: 2, mode: 'system', palette: 'graphite', theme: 'dark' },
    },
    {
      name: 'denied migration write still applies the legacy selection',
      initial: { [themeStorageKey]: v1('dark') },
      options: { denyWrite: true },
      prefersDark: false,
      expected: { version: 2, mode: 'dark', palette: 'graphite', theme: 'dark' },
    },
  ];

  it.each(cases)('matches the React resolver for $name', (scenario) => {
    const modelStorage = createStorage(scenario.initial, scenario.options);
    const preference = readAppearancePreference(modelStorage.storage);
    const resolved = resolveAppearance(preference, scenario.prefersDark);
    const bootstrap = runBootstrap({
      initial: scenario.initial,
      prefersDark: scenario.prefersDark,
      ...scenario.options,
    });

    expect(resolved).toEqual(scenario.expected);
    expect(bootstrap.dataset).toEqual({
      theme: scenario.expected.theme,
      themeMode: scenario.expected.mode,
      palette: scenario.expected.palette,
    });
    expect(bootstrap.mediaQueries).toEqual(
      scenario.expected.mode === 'system' ? ['(prefers-color-scheme: dark)'] : []
    );
  });

  it('migrates v1 to v2 without removing or changing v1', () => {
    const legacy = v1('dark');
    const bootstrap = runBootstrap({ initial: { [themeStorageKey]: legacy } });
    expect(bootstrap.peek(appearanceStorageKey)).toBe(v2('dark', 'graphite'));
    expect(bootstrap.peek(themeStorageKey)).toBe(legacy);
  });

  it('runs before any stylesheet and the React module', () => {
    const bootstrapIndex = consoleHtml.indexOf('<script>');
    const moduleIndex = consoleHtml.indexOf('<script type="module"');
    const stylesheetIndex = consoleHtml.search(/<link\s+[^>]*rel=["']stylesheet["']/i);
    expect(bootstrapIndex).toBeGreaterThan(-1);
    expect(moduleIndex).toBeGreaterThan(bootstrapIndex);
    if (stylesheetIndex !== -1) expect(stylesheetIndex).toBeGreaterThan(bootstrapIndex);
  });
});
