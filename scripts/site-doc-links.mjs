import path from 'node:path';

export function resolveDocumentLink(href, sourcePath, pages, repositoryURL) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(href)) return href;
  const match = /^([^?#]+\.md)([?#].*)?$/i.exec(href);
  if (!match) return href;
  const source = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), match[1]));
  if (source.startsWith('../')) throw new Error(`Documentation link escapes repository: ${href}`);
  const published = pages.find((page) => page.sourcePath === source);
  return (published?.path ?? `${repositoryURL}/blob/master/${encodeURI(source)}`) + (match[2] ?? '');
}
