const pathSeparatorPattern = /\\/g;
// These are the small icon modules Rollup otherwise repeats as one request per shared icon.
// Feature-only icons are deliberately absent so their route chunks remain self-contained and lazy.
const sharedLucideIcons = new Set([
  'activity',
  'braces',
  'check',
  'chevron-right',
  'circle-alert',
  'circle-check',
  'clock-3',
  'copy',
  'earth',
  'file-braces-corner',
  'folder-open',
  'gauge',
  'history',
  'key-round',
  'loader-circle',
  'lock-keyhole',
  'map',
  'play',
  'plus',
  'refresh-cw',
  'route',
  'save',
  'square',
  'trash-2',
  'triangle-alert',
  'upload',
]);

function normalizeModuleID(moduleID: string) {
  return moduleID.replace(pathSeparatorPattern, '/');
}

const routerPackagePattern =
  /\/node_modules\/@tanstack\/(?:history|react-router|react-store|router-core|store)\//;

export function isSharedLucideIconModule(moduleID: string) {
  const id = normalizeModuleID(moduleID);
  const icon = id.match(/\/node_modules\/lucide-react\/dist\/esm\/icons\/([^/]+)\.js$/)?.[1];
  return Boolean(icon && sharedLucideIcons.has(icon));
}

const eagerlyLoadedChunkPattern = /(?:^|\/)(?:console-core|rolldown-runtime)-[^/]+\.js$/;

export function consolePreloadDependencies(
  _filename: string,
  dependencies: string[],
  context: { hostType: 'html' | 'js' }
) {
  if (context.hostType === 'html') return dependencies;
  return dependencies.filter((dependency) => !eagerlyLoadedChunkPattern.test(dependency));
}

/**
 * Keep the console's already-eager framework/runtime modules in one stable cache unit.
 * Route-only code, including TanStack's navigation blocker, must remain lazy.
 */
export function isConsoleCoreModule(moduleID: string) {
  const id = normalizeModuleID(moduleID);
  if (id.endsWith('/node_modules/@tanstack/react-router/dist/esm/useBlocker.js')) return false;

  return (
    id.includes('/node_modules/react/') ||
    id.includes('/node_modules/react-dom/') ||
    routerPackagePattern.test(id) ||
    (id.includes('/node_modules/lucide-react/') && !id.includes('/icons/')) ||
    id.endsWith('/web/src/shared/runtime.ts')
  );
}
