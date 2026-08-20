export const browserProtoFolderLimits = Object.freeze({
  maxEnvelopeBytes: 20 * 1024 * 1024,
  maxTargetJSONBytes: 64 * 1024,
  maxManifestJSONBytes: 512 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
  maxFileBytes: 4 * 1024 * 1024,
  maxFiles: 512,
  maxPathBytes: 512,
  maxComponentBytes: 255,
  maxDepth: 32,
  maxInspectedEntries: 4096,
});

export type BrowserProtoFile = Readonly<{
  path: string;
  file: File;
}>;

export type BrowserProtoFolderSelection = Readonly<{
  rootName: string;
  files: readonly BrowserProtoFile[];
  totalBytes: number;
  ignoredFileCount: number;
}>;

export type ProtoFileHandle = Readonly<{
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
}>;

export type ProtoDirectoryHandle = Readonly<{
  kind: 'directory';
  name: string;
  values(): AsyncIterable<ProtoFileHandle | ProtoDirectoryHandle>;
}>;

const utf8 = new TextEncoder();
const windowsDeviceName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const windowsForbiddenCharacter = /[<>"|?*]/u;

function byteLength(value: string) {
  return utf8.encode(value).byteLength;
}

function comparePaths(left: BrowserProtoFile, right: BrowserProtoFile) {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function hasControlCharacter(value: string) {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true;
  }
  return false;
}

function simpleCaseFold(value: string) {
  let folded = '';
  for (const character of value) {
    const upper = character.toUpperCase();
    if (Array.from(upper).length === 1) {
      const lower = upper.toLowerCase();
      folded += Array.from(lower).length === 1 ? lower : upper;
      continue;
    }
    const lower = character.toLowerCase();
    folded += Array.from(lower).length === 1 ? lower : character;
  }
  return folded;
}

function validateRelativeProtoPath(path: string) {
  if (!path || path.startsWith('/') || path.includes('\\') || hasControlCharacter(path)) {
    throw new Error(
      `Invalid proto path: ${path || '(empty)'}. Paths must be relative POSIX paths.`
    );
  }
  if (path.includes(':') || windowsForbiddenCharacter.test(path)) {
    throw new Error(`Invalid proto path: ${path}. It contains characters forbidden on Windows.`);
  }
  if (!path.endsWith('.proto')) {
    throw new Error(
      `Invalid proto path: ${path}. Only the exact lowercase .proto suffix is allowed.`
    );
  }
  if (byteLength(path) > browserProtoFolderLimits.maxPathBytes) {
    throw new Error(`Proto path exceeds ${browserProtoFolderLimits.maxPathBytes} UTF-8 bytes.`);
  }

  const components = path.split('/');
  if (components.length > browserProtoFolderLimits.maxDepth) {
    throw new Error(
      `Proto path exceeds the ${browserProtoFolderLimits.maxDepth}-component depth cap.`
    );
  }
  for (const component of components) {
    if (!component || component === '.' || component === '..') {
      throw new Error(`Invalid proto path: ${path}. Empty and dot path segments are not allowed.`);
    }
    if (component.endsWith('.') || component.endsWith(' ')) {
      throw new Error(`Invalid proto path: ${path}. Components cannot end in a dot or space.`);
    }
    if (byteLength(component) > browserProtoFolderLimits.maxComponentBytes) {
      throw new Error(
        `Proto path component exceeds ${browserProtoFolderLimits.maxComponentBytes} UTF-8 bytes.`
      );
    }
    if (windowsDeviceName.test(component)) {
      throw new Error(`Invalid proto path: ${path}. Windows device basenames are not portable.`);
    }
  }
}

function validateFileSize(file: File, path: string) {
  if (!Number.isSafeInteger(file.size) || file.size < 0) {
    throw new Error(`Invalid file size for ${path}.`);
  }
  if (file.size > browserProtoFolderLimits.maxFileBytes) {
    throw new Error(`${path} exceeds the 4 MiB per-file cap.`);
  }
}

export function buildBrowserProtoFolderSelection(
  rootName: string,
  files: Iterable<BrowserProtoFile>,
  ignoredFileCount = 0
): BrowserProtoFolderSelection {
  const sorted: BrowserProtoFile[] = [];
  for (const file of files) {
    if (sorted.length >= browserProtoFolderLimits.maxFiles) {
      throw new Error(`Folder exceeds the ${browserProtoFolderLimits.maxFiles}-file cap.`);
    }
    sorted.push(file);
  }
  sorted.sort(comparePaths);
  if (sorted.length === 0) {
    throw new Error('No lowercase .proto files were found in this folder.');
  }
  if (sorted.length > browserProtoFolderLimits.maxFiles) {
    throw new Error(`Folder exceeds the ${browserProtoFolderLimits.maxFiles}-file cap.`);
  }

  let totalBytes = 0;
  const foldedPaths = new Set<string>();
  for (const entry of sorted) {
    validateRelativeProtoPath(entry.path);
    validateFileSize(entry.file, entry.path);
    const foldedPath = simpleCaseFold(entry.path);
    if (foldedPaths.has(foldedPath)) {
      throw new Error(`Proto paths collide when compared case-insensitively: ${entry.path}.`);
    }
    foldedPaths.add(foldedPath);
    totalBytes += entry.file.size;
    if (totalBytes > browserProtoFolderLimits.maxTotalBytes) {
      throw new Error('Folder exceeds the 16 MiB aggregate proto cap.');
    }
  }

  return {
    rootName: rootName.trim() || 'Selected folder',
    files: sorted,
    totalBytes,
    ignoredFileCount: Math.max(0, Math.trunc(ignoredFileCount)),
  };
}

export async function enumerateBrowserProtoDirectory(
  root: ProtoDirectoryHandle,
  signal?: AbortSignal
): Promise<BrowserProtoFolderSelection> {
  const files: BrowserProtoFile[] = [];
  let ignoredFileCount = 0;
  let inspectedEntries = 0;
  const pending: Array<{ directory: ProtoDirectoryHandle; prefix: string }> = [
    { directory: root, prefix: '' },
  ];

  function throwIfAborted() {
    if (signal?.aborted) throw new DOMException('Folder selection cancelled.', 'AbortError');
  }

  while (pending.length > 0) {
    throwIfAborted();
    const current = pending.pop();
    if (!current) break;
    for await (const handle of current.directory.values()) {
      throwIfAborted();
      inspectedEntries++;
      if (inspectedEntries > browserProtoFolderLimits.maxInspectedEntries) {
        throw new Error(
          `Folder exceeds the ${browserProtoFolderLimits.maxInspectedEntries}-entry inspection cap.`
        );
      }
      const path = current.prefix ? `${current.prefix}/${handle.name}` : handle.name;
      if (handle.kind === 'directory') {
        const depth = path.split('/').length;
        if (depth >= browserProtoFolderLimits.maxDepth) {
          throw new Error(
            `Folder exceeds the ${browserProtoFolderLimits.maxDepth}-component proto path depth cap.`
          );
        }
        pending.push({ directory: handle, prefix: path });
        continue;
      }
      if (!handle.name.endsWith('.proto')) {
        ignoredFileCount++;
        continue;
      }
      if (files.length >= browserProtoFolderLimits.maxFiles) {
        throw new Error(`Folder exceeds the ${browserProtoFolderLimits.maxFiles}-file cap.`);
      }
      const file = await handle.getFile();
      throwIfAborted();
      files.push({ path, file });
    }
    throwIfAborted();
  }

  return buildBrowserProtoFolderSelection(root.name, files, ignoredFileCount);
}

export function enumerateWebkitProtoFiles(files: Iterable<File>): BrowserProtoFolderSelection {
  const roots = new Set<string>();
  const protoFiles: BrowserProtoFile[] = [];
  let ignoredFileCount = 0;
  let inspectedEntries = 0;

  for (const file of files) {
    inspectedEntries++;
    if (inspectedEntries > browserProtoFolderLimits.maxInspectedEntries) {
      throw new Error(
        `Folder exceeds the ${browserProtoFolderLimits.maxInspectedEntries}-entry inspection cap.`
      );
    }
    const rawPath = file.webkitRelativePath;
    const components = rawPath.split('/');
    if (components.length < 2 || !components[0]) {
      throw new Error(
        'The browser did not provide a folder-relative path. Choose the folder again.'
      );
    }
    roots.add(components[0]);
    if (!rawPath.endsWith('.proto')) {
      ignoredFileCount++;
      continue;
    }
    protoFiles.push({ path: components.slice(1).join('/'), file });
  }

  if (roots.size !== 1) {
    throw new Error('Choose one folder at a time.');
  }
  return buildBrowserProtoFolderSelection(
    roots.values().next().value ?? 'Selected folder',
    protoFiles,
    ignoredFileCount
  );
}

export function formatProtoFolderBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
