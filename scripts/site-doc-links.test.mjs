import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDocumentLink } from './site-doc-links.mjs';

test('resolve Markdown links relative to their source, not the generated page', () => {
  const pages = [{ sourcePath: 'guides/capnp-workbench.md', path: '/capnp/' }];
  const link = (href) => resolveDocumentLink(href, 'guides/feature-roadmap.md', pages, 'https://github.com/owner/repo');
  assert.equal(link('capnp-workbench.md#schema'), '/capnp/#schema');
  assert.equal(link('../README.md'), 'https://github.com/owner/repo/blob/master/README.md');
  assert.equal(link('unpublished.md'), 'https://github.com/owner/repo/blob/master/guides/unpublished.md');
  for (const href of ['#section', '/install/', 'https://example.org/readme.md', 'mailto:hello@example.org', 'photo.png']) assert.equal(link(href), href);
  assert.throws(() => link('../../outside.md'), /escapes repository/);
});
