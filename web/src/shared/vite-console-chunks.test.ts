import { describe, expect, it } from 'vitest';

import {
  consolePreloadDependencies,
  isConsoleCoreModule,
  isSharedLucideIconModule,
} from '../../vite.console-chunks';

describe('console core chunk contract', () => {
  it.each([
    '/repo/node_modules/react/index.js',
    'C:\\repo\\node_modules\\react-dom\\client.js',
    '/repo/node_modules/@tanstack/router-core/dist/esm/router.js',
    '/repo/node_modules/@tanstack/react-router/dist/esm/link.js',
    '/repo/node_modules/lucide-react/dist/esm/createLucideIcon.js',
    '/repo/web/src/shared/runtime.ts',
  ])('groups an already-eager core module: %s', (moduleID) => {
    expect(isConsoleCoreModule(moduleID)).toBe(true);
  });

  it.each([
    '/repo/node_modules/lucide-react/dist/esm/icons/activity.js',
    'C:\\repo\\node_modules\\lucide-react\\dist\\esm\\icons\\refresh-cw.js',
  ])('recognizes a Lucide icon module on either path style: %s', (moduleID) => {
    expect(isSharedLucideIconModule(moduleID)).toBe(true);
  });

  it.each([
    '/repo/node_modules/@tanstack/react-router/dist/esm/useBlocker.js',
    '/repo/node_modules/@tanstack/query-core/build/modern/query.js',
    '/repo/node_modules/@cloudflare/speedtest/dist/index.js',
    '/repo/web/src/features/network/NetworkRoute.tsx',
  ])('leaves route-only modules out of the eager core: %s', (moduleID) => {
    expect(isConsoleCoreModule(moduleID)).toBeFalsy();
  });

  it('does not pull route-specific icons, Lucide infrastructure, or application code forward', () => {
    expect(
      isSharedLucideIconModule('/repo/node_modules/lucide-react/dist/esm/icons/accessibility.js')
    ).toBe(false);
    expect(
      isSharedLucideIconModule('/repo/node_modules/lucide-react/dist/esm/createLucideIcon.js')
    ).toBe(false);
    expect(isSharedLucideIconModule('/repo/web/src/console/App.tsx')).toBe(false);
  });

  it('keeps HTML startup hints and omits already-loaded chunks from lazy preload lists', () => {
    const dependencies = [
      'assets/console-core-hash.js',
      'assets/rolldown-runtime-hash.js',
      'assets/console-icons-hash.js',
      'assets/ThisPC-hash.js',
      'assets/ThisPC-hash.css',
    ];

    expect(consolePreloadDependencies('index.html', dependencies, { hostType: 'html' })).toEqual(
      dependencies
    );
    expect(
      consolePreloadDependencies('assets/index-hash.js', dependencies, { hostType: 'js' })
    ).toEqual(['assets/console-icons-hash.js', 'assets/ThisPC-hash.js', 'assets/ThisPC-hash.css']);
  });
});
