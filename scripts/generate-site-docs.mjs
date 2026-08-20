import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const docsRoot = path.join(repoRoot, 'docs');
const siteBase = '';
const siteRoot = 'https://protopeek.shreyam1008.com.np';
const repoRootURL = 'https://github.com/shreyam1008/ProtoPeek';

const publishedPages = [
  {
    slug: 'learn-grpc',
    title: 'Learn gRPC',
    section: 'Guide',
    description:
      'A transport-first walkthrough of proto contracts, reflection, HTTP/2, metadata, gRPC-Web, and debugging pressure points.',
    sourcePath: 'guides/learn-grpc.md',
    sourceURL: `${repoRootURL}/blob/master/guides/learn-grpc.md`,
    highlights: ['Proto contract', 'Reflection paths', 'HTTP/2 and trailers'],
  },
  {
    slug: 'feature-roadmap',
    title: 'Feature roadmap',
    section: 'Roadmap',
    description:
      'The shipped gRPC and bounded HTTP surfaces, their safety boundaries, and the gates for future transport-aware work.',
    sourcePath: 'guides/feature-roadmap.md',
    sourceURL: `${repoRootURL}/blob/master/guides/feature-roadmap.md`,
    highlights: ['gRPC + HTTP', 'Safety boundaries', 'Gated plans'],
  },
  {
    slug: 'vscode-extension-spec',
    title: 'VS Code / Open VSX spec',
    section: 'Extension',
    description:
      'A compact extension plan that launches ProtoPeek from `.proto` files without duplicating the gRPC client runtime.',
    sourcePath: 'guides/vscode-extension-spec.md',
    sourceURL: `${repoRootURL}/blob/master/guides/vscode-extension-spec.md`,
    highlights: ['Launch helper', '1 MB target', 'No duplicate client'],
  },
  {
    slug: 'launch-post',
    title: 'Launch post draft',
    section: 'Launch',
    description:
      'Positioning copy for introducing ProtoPeek as an independent local gRPC and HTTP workbench.',
    sourcePath: 'guides/launch-post.md',
    sourceURL: `${repoRootURL}/blob/master/guides/launch-post.md`,
    highlights: ['gRPC + HTTP', 'Independent branding', 'Protocol-native story'],
  },
  {
    slug: 'go-to-market',
    title: 'Go-to-market runbook',
    section: 'Launch',
    description:
      'A release-gated distribution and launch sequence for GitHub, native package managers, technical communities, and Product Hunt.',
    sourcePath: 'guides/go-to-market.md',
    sourceURL: `${repoRootURL}/blob/master/guides/go-to-market.md`,
    highlights: ['Release gate', 'Package channels', 'Human launch voice'],
  },
  {
    slug: 'contributor-rules',
    title: 'Contributor rules',
    section: 'Rules',
    description:
      'The engineering and product constraints that keep ProtoPeek dependency-conscious, transport-aware, and reliable under production debugging pressure.',
    sourcePath: 'AGENTS.md',
    sourceURL: `${repoRootURL}/blob/master/AGENTS.md`,
    highlights: ['Dependency budget', 'gRPC-aware UX', 'Docs stay aligned'],
  },
];

async function main() {
  await Promise.all([
    ...publishedPages.map((page) => writeMarkdownPage(page)),
    writeDocsHubPage(),
  ]);
}

async function writeMarkdownPage(page) {
  const source = await fs.readFile(path.join(repoRoot, page.sourcePath), 'utf8');
  const { body, toc, title } = renderMarkdownPage(source, page);
  const destination = path.join(docsRoot, page.slug, 'index.html');
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(
    destination,
    renderPageTemplate({
      title: page.title,
      documentTitle: `${page.title} | ProtoPeek`,
      description: page.description,
      canonicalPath: `/${page.slug}/`,
      section: page.section,
      intro: page.description,
      body,
      toc,
      sourceURL: page.sourceURL,
      sourcePath: page.sourcePath,
      highlights: page.highlights,
      heroVisual: renderHeroVisual(title, page.highlights),
    }),
  );
}

async function writeDocsHubPage() {
  const destination = path.join(docsRoot, 'docs', 'index.html');
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const body = `
    <section class="pp-doc-stack">
      <div class="pp-doc-grid-cards">
        <article class="pp-doc-card">
          <div class="pp-doc-pill">Fast path</div>
          <h2>README on GitHub</h2>
          <p>The quickest install and run path for people who already know what ProtoPeek is.</p>
          <a href="${repoRootURL}#readme" rel="noreferrer" target="_blank">Open README</a>
        </article>
        <article class="pp-doc-card">
          <div class="pp-doc-pill">Narrative path</div>
          <h2>Website</h2>
          <p>The visual gRPC and HTTP product story, install flow, and gRPC tutorial experience.</p>
          <a href="${siteRoot}/">Open homepage</a>
        </article>
        <article class="pp-doc-card">
          <div class="pp-doc-pill">Detailed path</div>
          <h2>Published guides</h2>
          <p>Long-form pages for the gRPC tutorial, roadmap, extension plan, launch runbook, and contributor rules.</p>
          <a href="${siteBase}/learn-grpc/">Start with Learn gRPC</a>
        </article>
      </div>
    </section>
    <section class="pp-doc-stack">
      <h2 id="published-guides">Published guides</h2>
      <div class="pp-doc-grid-cards">
        ${publishedPages
          .map(
            (page) => `
              <article class="pp-doc-card">
                <div class="pp-doc-pill">${page.section}</div>
                <h3>${escapeHtml(page.title)}</h3>
                <p>${escapeHtml(page.description)}</p>
                <div class="pp-doc-chip-row">
                  ${page.highlights
                    .map((highlight) => `<span>${escapeHtml(highlight)}</span>`)
                    .join('')}
                </div>
                <div class="pp-doc-card-links">
                  <a href="${siteBase}/${page.slug}/">Open page</a>
                  <a href="${page.sourceURL}" rel="noreferrer" target="_blank">Source markdown</a>
                </div>
              </article>
            `,
          )
          .join('')}
      </div>
    </section>
  `;

  await fs.writeFile(
    destination,
    renderPageTemplate({
      title: 'Docs hub',
      documentTitle: 'Docs hub | ProtoPeek',
      description:
        'Published ProtoPeek guides for gRPC, HTTP boundaries, roadmap planning, extension design, and contributor rules.',
      canonicalPath: '/docs/',
      section: 'Docs',
      intro:
        'ProtoPeek now publishes its guides as first-class pages instead of leaving them buried as raw markdown in the repository.',
      body,
      toc: [
        { id: 'published-guides', text: 'Published guides', level: 2 },
      ],
      sourceURL: `${repoRootURL}/tree/master/guides`,
      sourcePath: 'guides/ + AGENTS.md',
      highlights: ['Published pages', 'SEO-friendly routes', 'GitHub source links'],
      heroVisual: renderHeroVisual('Docs hub', [
        'Homepage',
        'Published guides',
        'Source markdown',
      ]),
    }),
  );
}

function renderMarkdownPage(markdown, page) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let index = 0;
  let title = page.title;
  const toc = [];
  const html = [];
  const slugCounts = new Map();
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }
    html.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };

  if (lines[0]?.startsWith('# ')) {
    title = lines[0].slice(2).trim();
    index = 1;
  }

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{2,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      const text = heading[2].trim();
      const id = uniqueSlug(slugify(text), slugCounts);
      toc.push({ id, text, level });
      html.push(`<h${level} id="${id}">${renderInline(text)}</h${level}>`);
      index += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      flushParagraph();
      const language = trimmed.slice(3).trim();
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      html.push(
        `<pre class="pp-doc-code"><code data-lang="${escapeAttr(language)}">${escapeHtml(
          code.join('\n'),
        )}</code></pre>`,
      );
      continue;
    }

    // Callout blocks: > [!NOTE], > [!TIP], > [!WARNING], > [!IMPORTANT], > [!CAUTION]
    const calloutMatch = trimmed.match(/^>\s*\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]/i);
    if (calloutMatch) {
      flushParagraph();
      const kind = calloutMatch[1].toLowerCase();
      const calloutLabels = {
        note: 'Note',
        tip: 'Tip',
        warning: 'Warning',
        important: 'Important',
        caution: 'Caution',
      };
      const calloutLines = [];
      index += 1;
      while (index < lines.length) {
        const nextLine = lines[index].trim();
        if (nextLine.startsWith('> ')) {
          calloutLines.push(nextLine.slice(2));
          index += 1;
        } else if (nextLine === '>') {
          calloutLines.push('');
          index += 1;
        } else {
          break;
        }
      }
      html.push(
        `<div class="pp-doc-callout pp-doc-callout-${kind}">` +
          `<div class="pp-doc-callout-label">${calloutLabels[kind]}</div>` +
          `<div>${renderInline(calloutLines.join(' ').trim())}</div>` +
          `</div>`,
      );
      continue;
    }

    // Markdown tables: lines starting with |
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      flushParagraph();
      const tableLines = [];
      while (index < lines.length && lines[index].trim().startsWith('|') && lines[index].trim().endsWith('|')) {
        tableLines.push(lines[index].trim());
        index += 1;
      }
      if (tableLines.length >= 2) {
        const parseRow = (row) =>
          row
            .slice(1, -1)
            .split('|')
            .map((cell) => cell.trim());
        const headerCells = parseRow(tableLines[0]);
        // Skip separator row (line with dashes/colons)
        const bodyStart = /^[\s|:-]+$/.test(tableLines[1]) ? 2 : 1;
        const bodyRows = tableLines.slice(bodyStart);
        const thead = `<thead><tr>${headerCells.map((c) => `<th>${renderInline(c)}</th>`).join('')}</tr></thead>`;
        const tbody =
          bodyRows.length > 0
            ? `<tbody>${bodyRows.map((row) => `<tr>${parseRow(row).map((c) => `<td>${renderInline(c)}</td>`).join('')}</tr>`).join('')}</tbody>`
            : '';
        html.push(`<table>${thead}${tbody}</table>`);
      }
      continue;
    }

    if (/^-\s+/.test(trimmed)) {
      flushParagraph();
      const items = [];
      while (index < lines.length && /^-\s+/.test(lines[index].trim())) {
        items.push(`<li>${renderInline(lines[index].trim().replace(/^-\s+/, ''))}</li>`);
        index += 1;
      }
      html.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      flushParagraph();
      const items = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        const current = lines[index].trim();
        const itemTitle = current.replace(/^\d+\.\s+/, '');
        const continuation = [];
        index += 1;
        while (index < lines.length) {
          const next = lines[index].trim();
          if (!next) {
            index += 1;
            break;
          }
          if (
            /^\d+\.\s+/.test(next) ||
            /^#{2,6}\s+/.test(next) ||
            next.startsWith('```') ||
            /^-\s+/.test(next)
          ) {
            break;
          }
          continuation.push(next);
          index += 1;
        }

        const parts = [`<div class="pp-doc-list-title">${renderInline(itemTitle)}</div>`];
        if (continuation.length > 0) {
          parts.push(`<p>${renderInline(continuation.join(' '))}</p>`);
        }
        items.push(`<li>${parts.join('')}</li>`);
      }
      html.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    paragraph.push(trimmed);
    index += 1;
  }

  flushParagraph();
  return {
    body: html.join('\n'),
    toc,
    title,
  };
}

function renderPageTemplate({
  title,
  documentTitle,
  description,
  canonicalPath,
  section,
  intro,
  body,
  toc,
  sourceURL,
  sourcePath,
  highlights,
  heroVisual,
}) {
  const canonicalURL = `${siteRoot}${canonicalPath}`;
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(documentTitle)}</title>
    <meta name="description" content="${escapeAttr(description)}" />
    <link rel="canonical" href="${canonicalURL}" />
    <link rel="icon" type="image/svg+xml" href="${siteBase}/favicon.svg" />
    <link rel="stylesheet" href="${siteBase}/docs.css" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${escapeAttr(documentTitle)}" />
    <meta property="og:description" content="${escapeAttr(description)}" />
    <meta property="og:url" content="${canonicalURL}" />
    <meta property="og:image" content="${siteRoot}/protopeek-social.png" />
    <meta property="og:image:secure_url" content="${siteRoot}/protopeek-social.png" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="ProtoPeek local gRPC and HTTP protocol workbench" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeAttr(documentTitle)}" />
    <meta name="twitter:description" content="${escapeAttr(description)}" />
    <meta name="twitter:image" content="${siteRoot}/protopeek-social.png" />
    <meta name="twitter:image:alt" content="ProtoPeek local gRPC and HTTP protocol workbench" />
  </head>
  <body>
    <div class="pp-doc-shell">
      <div class="pp-doc-orb pp-doc-orb-a"></div>
      <div class="pp-doc-orb pp-doc-orb-b"></div>
      <div class="pp-doc-container">
        <header class="pp-doc-topbar">
          <a class="pp-doc-brand" href="${siteBase}/">ProtoPeek</a>
          <nav class="pp-doc-nav">
            <a href="${siteBase}/">Home</a>
            <a href="${siteBase}/docs/">Docs</a>
            <a href="${siteBase}/learn-grpc/">Learn gRPC</a>
            <a href="${repoRootURL}" rel="noreferrer" target="_blank">GitHub</a>
          </nav>
        </header>

        <section class="pp-doc-hero">
          <div class="pp-doc-eyebrow">${escapeHtml(section)}</div>
          <div class="pp-doc-hero-grid">
            <div class="pp-doc-hero-copy">
              <h1>${escapeHtml(title)}</h1>
              <p>${escapeHtml(intro)}</p>
              <div class="pp-doc-chip-row">
                ${highlights.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}
              </div>
            </div>
            ${heroVisual}
          </div>
        </section>

        <main class="pp-doc-main">
          <article class="pp-doc-article">
            <div class="pp-doc-prose">
              ${body}
            </div>
          </article>

          <aside class="pp-doc-aside">
            <section class="pp-doc-side-card">
              <div class="pp-doc-side-label">On this page</div>
              <div class="pp-doc-toc">
                ${
                  toc.length > 0
                    ? toc
                        .map(
                          (item) =>
                            `<a class="level-${item.level}" href="#${item.id}">${escapeHtml(item.text)}</a>`,
                        )
                        .join('')
                    : '<span class="pp-doc-empty">No section headings in this page.</span>'
                }
              </div>
            </section>

            <section class="pp-doc-side-card">
              <div class="pp-doc-side-label">Source</div>
              <div class="pp-doc-source-path">${escapeHtml(sourcePath)}</div>
              <a href="${sourceURL}" rel="noreferrer" target="_blank">Open source markdown</a>
            </section>

            <section class="pp-doc-side-card">
              <div class="pp-doc-side-label">More ProtoPeek docs</div>
              <div class="pp-doc-related">
                ${publishedPages
                  .filter((item) => item.title !== title)
                  .map(
                    (item) =>
                      `<a href="${siteBase}/${item.slug}/"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.section)}</span></a>`,
                  )
                  .join('')}
              </div>
            </section>
          </aside>
        </main>
      </div>
    </div>
  </body>
</html>
`;
  return html.replace(/[ \t]+$/gm, '');
}

function renderHeroVisual(title, highlights) {
  const bars = highlights
    .map(
      (item, index) => `
        <div class="pp-doc-visual-row" style="animation-delay:${index * 140}ms">
          <span>${escapeHtml(item)}</span>
          <div class="pp-doc-visual-bar">
            <div class="pp-doc-visual-fill fill-${index + 1}"></div>
          </div>
        </div>
      `,
    )
    .join('');

  return `
    <div class="pp-doc-visual">
      <div class="pp-doc-visual-card">
        <div class="pp-doc-visual-label">Reading path</div>
        <div class="pp-doc-visual-title">${escapeHtml(title)}</div>
        <svg viewBox="0 0 300 120" aria-hidden="true">
          <path d="M12 88 C72 24 140 24 196 74 S262 110 288 32" />
          <circle cx="12" cy="88" r="6" />
          <circle cx="196" cy="74" r="6" />
          <circle cx="288" cy="32" r="6" />
        </svg>
      </div>
      <div class="pp-doc-visual-metrics">
        ${bars}
      </div>
    </div>
  `;
}

function renderInline(text) {
  const tokens = [];
  let value = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const key = `__PP_TOKEN_${tokens.length}__`;
    tokens.push(
      `<a href="${escapeAttr(href)}"${isExternal(href) ? ' rel="noreferrer" target="_blank"' : ''}>${escapeHtml(label)}</a>`,
    );
    return key;
  });

  value = value.replace(/`([^`]+)`/g, (_, code) => {
    const key = `__PP_TOKEN_${tokens.length}__`;
    tokens.push(`<code>${escapeHtml(code)}</code>`);
    return key;
  });

  value = escapeHtml(value);
  value = value.replace(
    /(^|[\s(])(https?:\/\/[^\s)]+)(?=($|[\s).]))/g,
    (_, prefix, url) =>
      `${prefix}<a href="${escapeAttr(url)}" rel="noreferrer" target="_blank">${escapeHtml(url)}</a>`,
  );
  value = value.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  value = value.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  for (const [index, token] of tokens.entries()) {
    value = value.replace(`__PP_TOKEN_${index}__`, token);
  }
  return value;
}

function uniqueSlug(base, counts) {
  const current = counts.get(base) ?? 0;
  counts.set(base, current + 1);
  return current === 0 ? base : `${base}-${current + 1}`;
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';
}

function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(text) {
  return escapeHtml(text);
}

function isExternal(href) {
  return /^https?:\/\//.test(href);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
