import { describe, expect, it, vi } from 'vitest';

import {
  browserProtoFolderLimits,
  buildBrowserProtoFolderSelection,
  enumerateBrowserProtoDirectory,
  enumerateWebkitProtoFiles,
  type ProtoDirectoryHandle,
} from './proto-folder';

function sizedFile(name: string, size: number, relativePath = '') {
  const file = { name, size, type: '', arrayBuffer: vi.fn() } as unknown as File;
  if (relativePath) {
    Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
  }
  return file;
}

function fileHandle(name: string, file: File) {
  return { kind: 'file' as const, name, getFile: vi.fn(async () => file) };
}

function directoryHandle(
  name: string,
  children: Array<ReturnType<typeof fileHandle> | ProtoDirectoryHandle>
): ProtoDirectoryHandle {
  return {
    kind: 'directory',
    name,
    async *values() {
      for (const child of children) yield child;
    },
  };
}

describe('browser proto-folder enumeration', () => {
  it('walks nested directory handles, preserves original Files, and sorts paths deterministically', async () => {
    const alpha = sizedFile('alpha.proto', 7);
    const zeta = sizedFile('zeta.proto', 11);
    const uppercase = sizedFile('ignored.PROTO', 13);
    const readme = sizedFile('README.md', 17);
    const root = directoryHandle('checkout', [
      fileHandle('zeta.proto', zeta),
      directoryHandle('nested', [
        fileHandle('ignored.PROTO', uppercase),
        fileHandle('alpha.proto', alpha),
      ]),
      fileHandle('README.md', readme),
    ]);

    const result = await enumerateBrowserProtoDirectory(root);

    expect(result.rootName).toBe('checkout');
    expect(result.files.map((entry) => entry.path)).toEqual(['nested/alpha.proto', 'zeta.proto']);
    expect(result.files.map((entry) => entry.file)).toEqual([alpha, zeta]);
    expect(result.totalBytes).toBe(18);
    expect(result.ignoredFileCount).toBe(2);
    expect(alpha.arrayBuffer).not.toHaveBeenCalled();
    expect(zeta.arrayBuffer).not.toHaveBeenCalled();
  });

  it('strips one common webkit root while preserving nested relative paths', () => {
    const b = sizedFile('b.proto', 2, 'picked/nested/b.proto');
    const a = sizedFile('a.proto', 1, 'picked/a.proto');
    const ignored = sizedFile('notes.txt', 99, 'picked/notes.txt');

    const result = enumerateWebkitProtoFiles([b, ignored, a]);

    expect(result.rootName).toBe('picked');
    expect(result.files).toEqual([
      { path: 'a.proto', file: a },
      { path: 'nested/b.proto', file: b },
    ]);
    expect(result.totalBytes).toBe(3);
    expect(result.ignoredFileCount).toBe(1);
  });

  it.each([
    ['absolute paths', '/escape.proto'],
    ['backslashes', 'nested\\escape.proto'],
    ['drive or ADS separators', 'C:escape.proto'],
    ['Windows-forbidden angle brackets', 'nested/<escape>.proto'],
    ['Windows-forbidden quotes', 'nested/"escape".proto'],
    ['Windows-forbidden pipes', 'nested/escape|pipe.proto'],
    ['Windows-forbidden wildcards', 'nested/escape?*.proto'],
    ['dot segments', 'nested/../escape.proto'],
    ['empty segments', 'nested//escape.proto'],
    ['components ending in a dot', 'nested./escape.proto'],
    ['components ending in a space', 'nested /escape.proto'],
    ['Windows device basenames', 'nested/COM1.proto'],
    ['uppercase suffixes', 'nested/escape.PROTO'],
    ['C0 control characters', 'nested/bell\u0007.proto'],
    ['C1 control characters', 'nested/control\u0085.proto'],
    ['DEL characters', 'nested/delete\u007f.proto'],
  ])('rejects %s before upload', (_reason, path) => {
    expect(() =>
      buildBrowserProtoFolderSelection('picked', [
        { path, file: sizedFile(path.split('/').at(-1) ?? '', 1) },
      ])
    ).toThrow();
  });

  it('rejects exact and case-folded path collisions', () => {
    expect(() =>
      buildBrowserProtoFolderSelection('picked', [
        { path: 'v1/User.proto', file: sizedFile('User.proto', 1) },
        { path: 'v1/user.proto', file: sizedFile('user.proto', 1) },
      ])
    ).toThrow(/collide/i);
    expect(() =>
      buildBrowserProtoFolderSelection('picked', [
        { path: 'v1/service.proto', file: sizedFile('service.proto', 1) },
        { path: 'v1/ſervice.proto', file: sizedFile('ſervice.proto', 1) },
      ])
    ).toThrow(/collide/i);
  });

  it('enforces file, aggregate, count, UTF-8 path/component, and depth caps', () => {
    expect(() =>
      buildBrowserProtoFolderSelection('picked', [
        {
          path: 'large.proto',
          file: sizedFile('large.proto', browserProtoFolderLimits.maxFileBytes + 1),
        },
      ])
    ).toThrow(/4 MiB/i);

    expect(() =>
      buildBrowserProtoFolderSelection(
        'picked',
        Array.from({ length: 5 }, (_, index) => ({
          path: `part-${index}.proto`,
          file: sizedFile(
            `part-${index}.proto`,
            Math.floor(browserProtoFolderLimits.maxTotalBytes / 5) + 1
          ),
        }))
      )
    ).toThrow(/16 MiB/i);

    expect(() =>
      buildBrowserProtoFolderSelection(
        'picked',
        Array.from({ length: browserProtoFolderLimits.maxFiles + 1 }, (_, index) => ({
          path: `${index}.proto`,
          file: sizedFile(`${index}.proto`, 1),
        }))
      )
    ).toThrow(/512/i);

    expect(() =>
      buildBrowserProtoFolderSelection('picked', [
        {
          path: `${'界'.repeat(86)}.proto`,
          file: sizedFile(`${'界'.repeat(86)}.proto`, 1),
        },
      ])
    ).toThrow(/component/i);

    const deepPath = `${Array.from({ length: 32 }, (_, index) => `d${index}`).join('/')}/x.proto`;
    expect(() =>
      buildBrowserProtoFolderSelection('picked', [
        { path: deepPath, file: sizedFile('x.proto', 1) },
      ])
    ).toThrow(/32/i);
  });

  it('rejects an empty lowercase .proto selection', () => {
    const ignored = sizedFile('UPPER.PROTO', 1, 'picked/UPPER.PROTO');
    expect(() => enumerateWebkitProtoFiles([ignored])).toThrow(/No lowercase \.proto files/i);
  });

  it('bounds every inspected file and directory, including ignored entries', async () => {
    const root: ProtoDirectoryHandle = {
      kind: 'directory',
      name: 'huge',
      async *values() {
        for (let index = 0; index <= browserProtoFolderLimits.maxInspectedEntries; index++) {
          yield fileHandle(`ignored-${index}.txt`, sizedFile(`ignored-${index}.txt`, 0));
        }
      },
    };

    await expect(enumerateBrowserProtoDirectory(root)).rejects.toThrow(
      new RegExp(String(browserProtoFolderLimits.maxInspectedEntries))
    );
  });

  it('bounds fallback FileList iteration before collecting it in memory', () => {
    let yielded = 0;
    const files: Iterable<File> = {
      *[Symbol.iterator]() {
        while (yielded <= browserProtoFolderLimits.maxInspectedEntries) {
          yield sizedFile(`ignored-${yielded++}.txt`, 0, `root/ignored-${yielded}.txt`);
        }
      },
    };

    expect(() => enumerateWebkitProtoFiles(files)).toThrow(
      new RegExp(String(browserProtoFolderLimits.maxInspectedEntries))
    );
    expect(yielded).toBe(browserProtoFolderLimits.maxInspectedEntries + 1);
  });

  it('rejects over-depth directories before iterating into them', async () => {
    const deepestValues = vi.fn(async function* () {
      yield fileHandle('never.proto', sizedFile('never.proto', 1));
    });
    let child: ProtoDirectoryHandle = {
      kind: 'directory',
      name: `d${browserProtoFolderLimits.maxDepth - 1}`,
      values: deepestValues,
    };
    for (let index = browserProtoFolderLimits.maxDepth - 2; index >= 0; index--) {
      child = directoryHandle(`d${index}`, [child]);
    }
    const root = directoryHandle('root', [child]);

    await expect(enumerateBrowserProtoDirectory(root)).rejects.toThrow(/32-component/i);
    expect(deepestValues).not.toHaveBeenCalled();
  });

  it('checks cancellation again after an awaited getFile', async () => {
    let resolveFile: ((file: File) => void) | undefined;
    const pending = new Promise<File>((resolve) => {
      resolveFile = resolve;
    });
    const root = directoryHandle('root', [
      { kind: 'file', name: 'slow.proto', getFile: vi.fn(() => pending) },
    ]);
    const controller = new AbortController();
    const enumeration = enumerateBrowserProtoDirectory(root, controller.signal);
    await Promise.resolve();
    controller.abort();
    resolveFile?.(sizedFile('slow.proto', 1));

    await expect(enumeration).rejects.toMatchObject({ name: 'AbortError' });
  });
});
