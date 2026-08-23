import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const docsRoot = path.join(repoRoot, 'docs');
const siteBase = '';
const siteRoot = 'https://protopeek.shreyam1008.com.np';
const repoRootURL = 'https://github.com/shreyam1008/ProtoPeek';
const downloaderCanonicalURL = `${siteRoot}/downloader/`;
const downloaderDescription =
  'ProtoPeek v0.5.0 Downloader is a local transfer workbench using system or configured aria2c with queue controls and SHA-256 evidence.';

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
    description: 'The shipped protocol workbench and the gates for future transport-aware work.',
    sourcePath: 'guides/feature-roadmap.md',
    sourceURL: `${repoRootURL}/blob/master/guides/feature-roadmap.md`,
    highlights: ['gRPC + HTTP', 'Safety boundaries', 'Gated plans'],
  },
  {
    slug: 'network-workbench',
    title: 'Network workbench',
    section: 'Guide',
    description:
      'A practical guide to DNS, kernel routes, Linux hop evidence, authorized private discovery, logical topology, local storage, and exchange formats.',
    sourcePath: 'guides/network-workbench.md',
    sourceURL: `${repoRootURL}/blob/master/guides/network-workbench.md`,
    highlights: ['Source RTT', 'Authorized /24 discovery', 'Logical topology'],
  },
  {
    slug: 'competitive-landscape',
    title: 'Competitive workflow decisions',
    section: 'Product research',
    description:
      'A source-backed comparison of workflows worth learning from and the boundaries that keep ProtoPeek focused.',
    sourcePath: 'guides/competitive-landscape.md',
    sourceURL: `${repoRootURL}/blob/master/guides/competitive-landscape.md`,
    highlights: ['Official sources', 'Workflow decisions', 'Lightweight boundaries'],
  },
  {
    slug: 'route-and-nmap-evidence',
    title: 'Network evidence boundaries',
    section: 'Guide',
    description:
      'Exact safety, trust, platform, and verification boundaries for next-hop lookup, active paths, private discovery, topology, and offline Nmap XML.',
    sourcePath: 'guides/route-and-nmap-evidence.md',
    sourceURL: `${repoRootURL}/blob/master/guides/route-and-nmap-evidence.md`,
    highlights: ['Source RTT', 'Authorized discovery', 'No hidden execution'],
  },
  {
    slug: 'transport-boundaries',
    title: 'Transport boundaries',
    section: 'Architecture',
    description:
      'The shared-shell contract, protocol-native adapter responsibilities, and permanent safety boundaries for ProtoPeek.',
    sourcePath: 'guides/transport-boundaries.md',
    sourceURL: `${repoRootURL}/blob/master/guides/transport-boundaries.md`,
    highlights: ['Local-first shell', 'Native evidence', 'Release gates'],
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
];

async function main() {
  await Promise.all([
    ...publishedPages.map((page) => writeMarkdownPage(page)),
    writeDocsHubPage(),
    writeDownloaderPage(),
  ]);
}

async function writeDownloaderPage() {
  const destination = path.join(docsRoot, 'downloader', 'index.html');
  await fs.mkdir(path.dirname(destination), { recursive: true });

  const structuredData = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'ProtoPeek Downloader',
    description: downloaderDescription,
    url: downloaderCanonicalURL,
    applicationCategory: 'DeveloperApplication',
    applicationSubCategory: 'Local download manager',
    operatingSystem: ['Linux', 'macOS', 'Windows'],
    isAccessibleForFree: true,
    softwareRequirements:
      'ProtoPeek v0.5.0 plus a system-installed or explicitly configured aria2c for Downloader.',
    screenshot: [
      `${siteRoot}/assets/protopeek-downloader-development.jpg`,
      `${siteRoot}/assets/protopeek-downloader-development-mobile.jpg`,
    ],
    featureList: [
      'One to 32 independent HTTP and HTTPS transfer jobs with partial-success reporting',
      'Per-job and whole-queue pause and resume controls, plus retry and cancel',
      'Explicit destination, bounded request headers, and User-Agent',
      'Single-job output naming and expected SHA-256 enforcement',
      'One-shot pp download command',
    ],
    additionalProperty: [
      {
        '@type': 'PropertyValue',
        name: 'Release status',
        value: 'Shipped in ProtoPeek v0.5.0',
      },
      {
        '@type': 'PropertyValue',
        name: 'Package-manager status',
        value: 'Homebrew and Scoop install v0.5.0 with aria2 declared as an external dependency',
      },
    ],
    softwareHelp: `${siteRoot}/docs/`,
    codeRepository: repoRootURL,
    author: {
      '@type': 'Person',
      name: 'Shreyam Adhikari',
      url: 'https://shreyam1008.com.np/',
    },
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
  }).replaceAll('<', '\\u003c');

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ProtoPeek Downloader | Local aria2c Transfer Workbench</title>
    <meta name="description" content="${escapeAttr(downloaderDescription)}" />
    <meta name="author" content="Shreyam Adhikari" />
    <meta name="creator" content="Shreyam Adhikari" />
    <meta name="application-name" content="ProtoPeek" />
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
    <meta name="theme-color" content="#0d9488" />
    <meta name="referrer" content="strict-origin-when-cross-origin" />
    <link rel="canonical" href="${downloaderCanonicalURL}" />
    <link rel="icon" type="image/svg+xml" href="${siteBase}/favicon.svg" />
    <link rel="manifest" href="${siteBase}/site.webmanifest" />
    <link rel="stylesheet" href="${siteBase}/docs.css" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="ProtoPeek" />
    <meta property="og:title" content="ProtoPeek Downloader | Local aria2c Transfer Workbench" />
    <meta property="og:description" content="${escapeAttr(downloaderDescription)}" />
    <meta property="og:url" content="${downloaderCanonicalURL}" />
    <meta property="og:locale" content="en_US" />
    <meta property="og:image" content="${siteRoot}/assets/protopeek-downloader-development.jpg" />
    <meta property="og:image:secure_url" content="${siteRoot}/assets/protopeek-downloader-development.jpg" />
    <meta property="og:image:type" content="image/jpeg" />
    <meta property="og:image:width" content="1487" />
    <meta property="og:image:height" content="1058" />
    <meta property="og:image:alt" content="ProtoPeek v0.5.0 Downloader with completed local aria2 transfers and expected SHA-256 evidence" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="ProtoPeek Downloader | Local aria2c Transfer Workbench" />
    <meta name="twitter:description" content="${escapeAttr(downloaderDescription)}" />
    <meta name="twitter:image" content="${siteRoot}/assets/protopeek-downloader-development.jpg" />
    <meta name="twitter:image:alt" content="ProtoPeek v0.5.0 Downloader with completed local aria2 transfers and expected SHA-256 evidence" />
    <script type="application/ld+json">${structuredData}</script>
  </head>
  <body>
    <div class="pp-doc-shell pp-download-shell">
      <div class="pp-doc-orb pp-doc-orb-a"></div>
      <div class="pp-doc-orb pp-doc-orb-b"></div>
      <div class="pp-doc-container">
        <header class="pp-doc-topbar">
          <a class="pp-doc-brand" href="${siteBase}/" aria-label="ProtoPeek home">ProtoPeek</a>
          <nav class="pp-doc-nav" aria-label="Primary">
            <a href="${siteBase}/">Home</a>
            <a href="${siteBase}/docs/">Docs</a>
            <a href="${repoRootURL}/blob/master/README.md" rel="noreferrer" target="_blank">Installation</a>
            <a href="${repoRootURL}" rel="noreferrer" target="_blank">GitHub</a>
          </nav>
        </header>

        <main class="pp-download-main">
          <section class="pp-download-hero" aria-labelledby="downloader-title">
            <div class="pp-download-hero-copy">
              <h1 id="downloader-title">Download locally. Keep every decision visible.</h1>
              <p>
                ProtoPeek v0.5.0 gives users one explicit local queue for
                HTTP(S) transfers: queue one or up to 32 independent jobs, see partial success,
                pause or resume one job or the whole queue, retry, cancel, choose the destination,
                and enforce a single-job expected SHA-256 without sending transfer details to a hosted service.
              </p>
              <div class="pp-download-actions">
                <a class="pp-download-action-primary" href="${repoRootURL}/releases/tag/v0.5.0" rel="noreferrer" target="_blank">Open v0.5.0 release</a>
                <a class="pp-download-action-secondary" href="${siteBase}/docs/">Read installation boundaries</a>
              </div>
              <dl class="pp-download-truth">
                <div>
                  <dt>Available now</dt>
                  <dd>Stable ProtoPeek v0.5.0</dd>
                </div>
                <div>
                  <dt>Package channels</dt>
                  <dd>Homebrew and Scoop install v0.5.0</dd>
                </div>
                <div>
                  <dt>Transfer engine</dt>
                  <dd>System-installed or explicitly configured aria2c</dd>
                </div>
              </dl>
            </div>

            <figure class="pp-download-media pp-download-media-hero">
              <img
                src="${siteBase}/assets/protopeek-downloader-development.jpg"
                alt="ProtoPeek v0.5.0 Downloader desktop with completed local aria2 transfers and expected SHA-256 evidence"
                width="1487"
                height="1058"
                decoding="async"
              />
              <figcaption>
                Real Chrome capture of the feature source promoted into v0.5.0. The two local fixture
                transfers completed through system aria2c; the selected item shows expected SHA-256 enforcement.
              </figcaption>
            </figure>
          </section>

          <section class="pp-download-section" aria-labelledby="workflow-title">
            <div class="pp-download-section-heading">
              <h2 id="workflow-title">A bounded transfer workflow, not a hidden service.</h2>
              <p>The browser surface starts its local engine only when asked and keeps control and verification evidence beside the queue.</p>
            </div>
            <ol class="pp-download-steps">
              <li><strong>Queue deliberately.</strong><span>Add one URL or up to 32 independent jobs. A destination, bounded headers, and User-Agent can apply to each; output name and SHA-256 stay single-job only.</span></li>
              <li><strong>Control visibly.</strong><span>Pause or resume one job or the whole queue, retry, or cancel from the same local surface that owns the engine.</span></li>
              <li><strong>Finish with evidence.</strong><span>See the terminal state, completed path, and checksum result without an opaque cloud job.</span></li>
            </ol>
          </section>

          <section class="pp-download-split" aria-labelledby="cli-title">
            <figure class="pp-download-media pp-download-media-mobile">
              <img
                src="${siteBase}/assets/protopeek-downloader-development-mobile.jpg"
                alt="ProtoPeek v0.5.0 Downloader queue at a 390 by 844 responsive viewport"
                width="390"
                height="844"
                loading="lazy"
                decoding="async"
              />
              <figcaption>Real Chrome capture at 390 × 844. The responsive queue preserves status and controls without inventing a mobile-only workflow.</figcaption>
            </figure>

            <div class="pp-download-cli">
              <h2 id="cli-title">The same boundary in one command.</h2>
              <p>
                v0.5.0 also exposes a one-shot command for scripts and terminals. It
                owns its local engine session, writes progress to stderr, prints the completed path
                to stdout, and preserves partial data plus the aria2 session if interrupted.
              </p>
              <pre><code>pp download [--output NAME] [--sha256 64_HEX] URL</code></pre>
              <p class="pp-download-note">
                It does not attach to an already-running ProtoPeek browser process. URL support is
                deliberately limited to HTTP and HTTPS in this development slice.
              </p>
              <div class="pp-download-link-list" aria-label="Downloader documentation">
                <a href="${siteBase}/man/pp.1">Read the pp(1) manual</a>
                <a href="${siteBase}/man/protopeek.1">Read the protopeek(1) manual</a>
                <a href="${repoRootURL}/blob/master/README.md" rel="noreferrer" target="_blank">Build and installation notes</a>
              </div>
            </div>
          </section>

          <section class="pp-download-section pp-download-requirements" aria-labelledby="requirements-title">
            <div>
              <h2 id="requirements-title">Install the engine; ProtoPeek does not bundle it.</h2>
              <p>
                Downloader resolves an explicitly configured aria2c binary or the system aria2c on
                PATH. That keeps the MIT ProtoPeek distribution separate from aria2 and makes the
                process boundary inspectable. Homebrew and Scoop install v0.5.0 and declare aria2 as
                an external package dependency, so Downloader is available without bundling the engine.
              </p>
            </div>
            <div class="pp-download-requirement-links">
              <a href="${siteBase}/docs/">Published documentation</a>
              <a href="${repoRootURL}/blob/master/README.md" rel="noreferrer" target="_blank">Release setup</a>
              <a href="${repoRootURL}/releases/tag/v0.5.0" rel="noreferrer" target="_blank">Stable v0.5.0 release</a>
            </div>
          </section>

          <section class="pp-download-migration" aria-labelledby="migration-title">
            <h2 id="migration-title">GoBarryGo migration stays reversible.</h2>
            <p>
              ProtoPeek v0.5.0 has an explicit bridge for GoBarryGo's one known local profile.
              Preview is read-only; import accepts only bounded regular files and allowlisted aria2
              session options, keeps GoBarryGo files unchanged, and pauses imported jobs. Private
              receipts make rollback possible only while ProtoPeek state still matches. The public
              redirect and package retirement are not complete; repository retirement is also
              incomplete, and GoBarryGo v0.0.9 plus its public history remain independently available.
            </p>
            <a href="${repoRootURL}/blob/master/guides/gobarrygo-consolidation.md" rel="noreferrer" target="_blank">Read the consolidation and migration record</a>
          </section>
        </main>

        <footer class="pp-download-footer">
          <p>ProtoPeek by <a href="https://shreyam1008.com.np/" rel="noreferrer" target="_blank">Shreyam Adhikari</a></p>
          <p>Real product evidence. Explicit release boundaries. Local control.</p>
        </footer>
      </div>
    </div>
  </body>
</html>
`;

  await fs.writeFile(destination, html.replace(/[ \t]+$/gm, ''));
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
    })
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
          <p>Long-form pages for gRPC, the network workbench, product research, evidence boundaries, transport architecture, the roadmap, and extension design.</p>
          <a href="${siteBase}/network-workbench/">Open the network workbench guide</a>
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
            `
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
        'Published ProtoPeek guides for gRPC, HTTP boundaries, network-path and topology evidence, roadmap planning, and extension design.',
      canonicalPath: '/docs/',
      section: 'Docs',
      intro:
        'ProtoPeek publishes its guides as first-class pages, from the gRPC fast path through bounded network evidence and its trust boundaries.',
      body,
      toc: [{ id: 'published-guides', text: 'Published guides', level: 2 }],
      sourceURL: `${repoRootURL}/tree/master/guides`,
      sourcePath: 'guides/',
      highlights: ['Protocol guides', 'Network evidence', 'GitHub source links'],
      heroVisual: renderHeroVisual('Docs hub', [
        'Homepage',
        'Network workbench',
        'Source markdown',
      ]),
      schemaType: 'CollectionPage',
    })
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
          code.join('\n')
        )}</code></pre>`
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
          `</div>`
      );
      continue;
    }

    // Markdown tables: lines starting with |
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      flushParagraph();
      const tableLines = [];
      while (
        index < lines.length &&
        lines[index].trim().startsWith('|') &&
        lines[index].trim().endsWith('|')
      ) {
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
            ? `<tbody>${bodyRows
                .map(
                  (row) =>
                    `<tr>${parseRow(row)
                      .map((c) => `<td>${renderInline(c)}</td>`)
                      .join('')}</tr>`
                )
                .join('')}</tbody>`
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
  schemaType = 'TechArticle',
}) {
  const canonicalURL = `${siteRoot}${canonicalPath}`;
  const structuredData = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': schemaType,
    headline: title,
    description,
    url: canonicalURL,
    mainEntityOfPage: canonicalURL,
    author: {
      '@type': 'Person',
      name: 'Shreyam Adhikari',
      url: 'https://shreyam1008.com.np/',
    },
    isPartOf: {
      '@type': 'WebSite',
      name: 'ProtoPeek',
      url: `${siteRoot}/`,
    },
  }).replaceAll('<', '\\u003c');
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(documentTitle)}</title>
    <meta name="description" content="${escapeAttr(description)}" />
    <meta name="author" content="Shreyam Adhikari" />
    <meta name="creator" content="Shreyam Adhikari" />
    <meta name="application-name" content="ProtoPeek" />
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
    <meta name="theme-color" content="#0d9488" />
    <meta name="referrer" content="strict-origin-when-cross-origin" />
    <link rel="canonical" href="${canonicalURL}" />
    <link rel="icon" type="image/svg+xml" href="${siteBase}/favicon.svg" />
    <link rel="manifest" href="${siteBase}/site.webmanifest" />
    <link rel="stylesheet" href="${siteBase}/docs.css" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="ProtoPeek" />
    <meta property="og:title" content="${escapeAttr(documentTitle)}" />
    <meta property="og:description" content="${escapeAttr(description)}" />
    <meta property="og:url" content="${canonicalURL}" />
    <meta property="og:locale" content="en_US" />
    <meta property="og:image" content="${siteRoot}/protopeek-social-v3.png" />
    <meta property="og:image:secure_url" content="${siteRoot}/protopeek-social-v3.png" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="ProtoPeek local protocol workbench showing gRPC Health, HTTP, and bounded discovery" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeAttr(documentTitle)}" />
    <meta name="twitter:description" content="${escapeAttr(description)}" />
    <meta name="twitter:image" content="${siteRoot}/protopeek-social-v3.png" />
    <meta name="twitter:image:alt" content="ProtoPeek local protocol workbench showing gRPC Health, HTTP, and bounded discovery" />
    <script type="application/ld+json">${structuredData}</script>
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
                            `<a class="level-${item.level}" href="#${item.id}">${escapeHtml(item.text)}</a>`
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
                      `<a href="${siteBase}/${item.slug}/"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.section)}</span></a>`
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
      `
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
      `<a href="${escapeAttr(href)}"${isExternal(href) ? ' rel="noreferrer" target="_blank"' : ''}>${escapeHtml(label)}</a>`
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
      `${prefix}<a href="${escapeAttr(url)}" rel="noreferrer" target="_blank">${escapeHtml(url)}</a>`
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
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  );
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
