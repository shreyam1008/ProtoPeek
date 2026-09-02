import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const docsRoot = path.join(repoRoot, 'docs');
const publicRoot = path.join(repoRoot, 'web', 'site', 'public');
const siteBase = '';
const siteRoot = 'https://protopeek.shreyam1008.com.np';
const repoRootURL = 'https://github.com/shreyam1008/ProtoPeek';
const registryPath = path.join(repoRoot, 'web', 'src', 'site', 'public-pages.json');
const registry = JSON.parse(await fs.readFile(registryPath, 'utf8'));
const publicPages = registry.pages;
const publishedPages = publicPages.filter((page) => page.generator === 'markdown');
const hubPages = publicPages.filter((page) => page.group && page.kind !== 'root');
const downloaderPage = requirePage('downloader');

validateRegistry();

async function main() {
  await Promise.all([
    ...publishedPages.map((page) => writeMarkdownPage(page)),
    writeDocsHubPage(),
    writeDownloaderPage(),
  ]);
  await writeDiscoveryMetadata();
}

function requirePage(id) {
  const page = publicPages.find((candidate) => candidate.id === id);
  if (!page) throw new Error(`Missing public page registry entry: ${id}`);
  return page;
}

function validateRegistry() {
  if (registry.schemaVersion !== 1 || !Array.isArray(publicPages)) {
    throw new Error('Unsupported ProtoPeek public page registry.');
  }
  const ids = new Set();
  const paths = new Set();
  for (const page of publicPages) {
    if (!page.id || ids.has(page.id)) throw new Error(`Duplicate or missing page id: ${page.id}`);
    if (!page.path?.startsWith('/') || (page.path !== '/' && !page.path.endsWith('/'))) {
      throw new Error(`Public page paths must use canonical trailing slashes: ${page.path}`);
    }
    if (page.path.includes('#') || paths.has(page.path)) {
      throw new Error(`Duplicate or fragment public page path: ${page.path}`);
    }
    if (!page.documentTitle || !page.description) {
      throw new Error(`Public page ${page.id} needs unique title and description metadata.`);
    }
    if (page.generator === 'markdown' && !page.sourcePath) {
      throw new Error(`Markdown page ${page.id} is missing sourcePath.`);
    }
    if (
      page.keywords !== undefined &&
      (!Array.isArray(page.keywords) ||
        page.keywords.some((keyword) => typeof keyword !== 'string'))
    ) {
      throw new Error(`Public page ${page.id} keywords must be an array of strings.`);
    }
    ids.add(page.id);
    paths.add(page.path);
  }
}

async function writeDiscoveryMetadata() {
  const sitemap = renderSitemap();
  const llms = renderLLMSText();
  await Promise.all([
    fs.writeFile(path.join(publicRoot, 'sitemap.xml'), sitemap),
    fs.writeFile(path.join(docsRoot, 'sitemap.xml'), sitemap),
    fs.writeFile(path.join(publicRoot, 'llms.txt'), llms),
    fs.writeFile(path.join(docsRoot, 'llms.txt'), llms),
  ]);
}

function renderSitemap() {
  const entries = publicPages
    .filter((page) => page.sitemap)
    .map(
      (page) => `  <url>
    <loc>${escapeXml(`${siteRoot}${page.path}`)}</loc>
    <lastmod>${page.lastModified ?? registry.lastModified}</lastmod>
    <changefreq>${escapeXml(page.sitemap.changefreq)}</changefreq>
    <priority>${escapeXml(page.sitemap.priority)}</priority>
  </url>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`;
}

function renderLLMSText() {
  const pages = hubPages
    .map(
      (page) =>
        `- ${page.title}: ${siteRoot}${page.path}${page.status ? ` — ${page.status.label}` : ''}`
    )
    .join('\n');
  return `# ProtoPeek

> ProtoPeek is a lightweight local workbench for finding, reaching, and inspecting services without flattening protocol-specific evidence.

Primary site: ${siteRoot}/
Author: https://shreyam1008.com.np/
Repository: ${repoRootURL}

## Release truth

- v0.5.0 is the current stable release. Its areas are exactly Overview, Protocols, Network, Downloader, Security, and Settings.
- Stable v0.5.0 provides protocol-native gRPC and HTTP, bounded target and private-network discovery, read-only route evidence, Linux consented path evidence, logical topology, offline Nmap XML import, local downloads, and consented Security evidence.
- The verified release resolvers and \`@latest\` install v0.5.0 from checksum-pinned release archives.
- The owned Homebrew and Scoop channels install v0.5.0 from checksum-pinned release archives and declare aria2 as an external package dependency. ProtoPeek does not bundle aria2.

## Current source after v0.5.0

- Current source adds a seventh route-lazy area, This PC. It is not part of the published v0.5.0 packages.
- This PC reads local process-perspective identity and interfaces first. Linux-only socket/process inspection, one-shot interface load, public IPv4/IPv6 and BGP-origin observation, and the bounded Cloudflare quality plan each require an explicit action.
- Current source also adds an eighth route-lazy area, Cloudflare Tunnel. It is not part of the published v0.5.0 packages.
- Cloudflare Tunnel starts only from explicit local actions. It inspects the real host, compares cloudflared with the official release on request, and confirms, stale-guards, and verifies canonical OS service control. Route drafts remain browser-only; config/account writes, password capture, automatic installation or update, Docker-daemon access, and background polling stay unavailable.
- Downloader host settings and the local derived website evidence report are current-source refinements, not stable v0.5.0 claims.
- Private Access and Tailscale, Headscale, and NetBird workflows remain planned; none ships in the stable release or current source.

## v0.5.0 capability boundary

- Downloader product page: ${siteRoot}/downloader/
- Downloader uses an explicitly configured or system-installed \`aria2c\`; ProtoPeek does not bundle aria2.
- Website observation requires separate consent and sends exactly one credential-free, non-following \`HEAD\` request to a public-only target. It reads no body, follows no redirect, and emits no security score.
- GoBarryGo files, releases, repository history, and public origin remain independent; the public redirect and retirement are not complete.

## Public features and guides

${pages}

## Stable install

- Homebrew: \`brew install shreyam1008/tap/protopeek\`
- Scoop: \`scoop bucket add shreyam https://github.com/shreyam1008/scoop-bucket\`, then \`scoop install shreyam/protopeek\`
- Unix resolver: \`curl -fsSL https://raw.githubusercontent.com/shreyam1008/ProtoPeek/master/install.sh | sh\`
- PowerShell resolver: \`irm https://raw.githubusercontent.com/shreyam1008/ProtoPeek/master/install.ps1 | iex\`
`;
}

async function writeDownloaderPage() {
  const downloaderCanonicalURL = `${siteRoot}${downloaderPage.path}`;
  const downloaderDescription = downloaderPage.description;
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
    breadcrumb: {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${siteRoot}/` },
        { '@type': 'ListItem', position: 2, name: 'Guides', item: `${siteRoot}/docs/` },
        {
          '@type': 'ListItem',
          position: 3,
          name: downloaderPage.title,
          item: downloaderCanonicalURL,
        },
      ],
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
    <meta name="theme-color" content="#0b5cff" />
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
    <a class="pp-skip-link" href="#main-content">Skip to content</a>
    <div class="pp-doc-shell pp-download-shell">
      <div class="pp-doc-container">
        ${renderTopbar()}

        <main class="pp-download-main" id="main-content">
          ${renderBreadcrumb(downloaderPage.title, downloaderPage.path)}
          <section class="pp-download-hero" aria-labelledby="downloader-title">
            <div class="pp-download-hero-copy">
              <h1 id="downloader-title">Download locally. Keep every decision visible.</h1>
              <p>
                ProtoPeek v0.5.0 gives users one explicit local queue for
                HTTP(S) transfers: queue one or up to 32 independent jobs, see partial success,
                pause or resume one job or the whole queue, retry, cancel, choose the destination,
                and enforce a single-job expected SHA-256 without sending transfer details to a hosted service.
              </p>
              ${renderStatus(downloaderPage.status)}
              <p class="pp-download-boundary">${escapeHtml(downloaderPage.status.detail)}</p>
              <div class="pp-download-actions">
                <a class="pp-download-action-primary" href="${repoRootURL}/releases/tag/v0.5.0" rel="noreferrer" target="_blank">Open v0.5.0 release</a>
                <a class="pp-download-action-secondary" href="${siteBase}/install/">Read installation boundaries</a>
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
          ${renderRelatedNavigation(downloaderPage.id)}
        </main>

        ${renderFooter()}
      </div>
    </div>
  </body>
</html>
`;

  await fs.writeFile(destination, html.replace(/[ \t]+$/gm, ''));
}

async function writeMarkdownPage(page) {
  const source = await fs.readFile(path.join(repoRoot, page.sourcePath), 'utf8');
  const { body, toc } = renderMarkdownPage(source, page);
  const destination = path.join(docsRoot, page.slug, 'index.html');
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(
    destination,
    renderPageTemplate({
      title: page.title,
      documentTitle: page.documentTitle,
      description: page.description,
      canonicalPath: page.path,
      intro: page.question || page.description,
      body,
      toc,
      sourceURL: `${repoRootURL}/blob/master/${page.sourcePath}`,
      sourcePath: page.sourcePath,
      highlights: page.highlights,
      heroVisual: renderFeatureVisual(page),
      status: page.status,
      flow: page.flow,
      pageId: page.id,
      lastModified: page.lastModified,
      keywords: page.keywords,
    })
  );
}

async function writeDocsHubPage() {
  const docsPage = requirePage('docs');
  const destination = path.join(docsRoot, 'docs', 'index.html');
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const body = registry.groups
    .map((group) => {
      const pages = hubPages.filter((page) => page.group === group.id);
      if (!pages.length) return '';
      return `
        <section class="pp-guide-group" id="${escapeAttr(group.id)}">
          <header class="pp-guide-group-heading">
            <h2>${escapeHtml(group.title)}</h2>
            <p>${escapeHtml(group.description)}</p>
          </header>
          <div class="pp-guide-list">
            ${pages
              .map(
                (page, index) => `
                  <a class="pp-guide-row" href="${page.path}">
                    <span class="pp-guide-index" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>
                    <span class="pp-guide-row-copy">
                      <strong>${escapeHtml(page.title)}</strong>
                      <small>${escapeHtml(page.question || page.description)}</small>
                    </span>
                    ${renderStatus(page.status, 'compact')}
                    <span class="pp-guide-arrow" aria-hidden="true">${arrowIcon()}</span>
                  </a>
                `
              )
              .join('')}
          </div>
        </section>
      `;
    })
    .join('');

  await fs.writeFile(
    destination,
    renderPageTemplate({
      title: docsPage.title,
      documentTitle: docsPage.documentTitle,
      description: docsPage.description,
      canonicalPath: docsPage.path,
      intro:
        'Choose the thing you want to understand. Every page shows what to do, what evidence appears, and where the boundary ends.',
      body,
      toc: registry.groups.map((group) => ({ id: group.id, text: group.title, level: 2 })),
      sourceURL: `${repoRootURL}/blob/master/web/src/site/public-pages.json`,
      sourcePath: 'web/src/site/public-pages.json',
      highlights: docsPage.highlights,
      heroVisual: renderFeatureVisual(docsPage),
      schemaType: 'CollectionPage',
      pageId: docsPage.id,
      lastModified: docsPage.lastModified,
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
        const itemLines = [lines[index].trim().replace(/^-\s+/, '')];
        index += 1;
        while (
          index < lines.length &&
          lines[index].trim() &&
          /^\s{2,}\S/.test(lines[index]) &&
          !/^-\s+/.test(lines[index].trim())
        ) {
          itemLines.push(lines[index].trim());
          index += 1;
        }
        items.push(`<li>${renderInline(itemLines.join(' '))}</li>`);
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
  intro,
  body,
  toc,
  sourceURL,
  sourcePath,
  highlights,
  heroVisual,
  schemaType = 'TechArticle',
  status,
  flow,
  pageId,
  lastModified,
  keywords = [],
}) {
  const canonicalURL = `${siteRoot}${canonicalPath}`;
  const breadcrumbItems = [
    { name: 'Home', item: `${siteRoot}/` },
    { name: 'Guides', item: `${siteRoot}/docs/` },
  ];
  if (canonicalPath !== '/docs/') breadcrumbItems.push({ name: title, item: canonicalURL });
  const structuredData = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': schemaType,
    headline: title,
    description,
    url: canonicalURL,
    mainEntityOfPage: canonicalURL,
    dateModified: lastModified ?? registry.lastModified,
    isBasedOn: sourceURL,
    keywords: keywords.length > 0 ? keywords : undefined,
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
    about: {
      '@type': 'SoftwareApplication',
      '@id': `${siteRoot}/#software`,
      name: 'ProtoPeek',
      operatingSystem: ['Linux', 'macOS', 'Windows'],
      applicationCategory: 'DeveloperApplication',
    },
    breadcrumb: {
      '@type': 'BreadcrumbList',
      itemListElement: breadcrumbItems.map((item, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        ...item,
      })),
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
    <meta name="theme-color" content="#0b5cff" />
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
    <meta property="og:image:alt" content="ProtoPeek local systems workbench with protocol, network, machine, security, and download evidence" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeAttr(documentTitle)}" />
    <meta name="twitter:description" content="${escapeAttr(description)}" />
    <meta name="twitter:image" content="${siteRoot}/protopeek-social-v3.png" />
    <meta name="twitter:image:alt" content="ProtoPeek local systems workbench with protocol, network, machine, security, and download evidence" />
    <script type="application/ld+json">${structuredData}</script>
  </head>
  <body>
    <a class="pp-skip-link" href="#main-content">Skip to content</a>
    <div class="pp-doc-shell">
      <div class="pp-doc-container">
        ${renderTopbar()}

        <main id="main-content">
          ${renderBreadcrumb(title, canonicalPath)}
          <section class="pp-doc-hero" aria-labelledby="page-title">
          <div class="pp-doc-hero-grid">
            <div class="pp-doc-hero-copy">
              <h1 id="page-title">${escapeHtml(title)}</h1>
              <p>${escapeHtml(intro)}</p>
              ${renderStatus(status)}
              <ul class="pp-doc-highlights" aria-label="Page highlights">
                ${highlights.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
              </ul>
            </div>
            ${heroVisual}
          </div>
          </section>

          ${renderFlow(flow)}

          <div class="pp-doc-main">
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
                      : '<span class="pp-doc-empty">Use the guide groups below.</span>'
                  }
                </div>
              </section>

              <section class="pp-doc-side-card">
                <div class="pp-doc-side-label">Source</div>
                <div class="pp-doc-source-path">${escapeHtml(sourcePath)}</div>
                <a href="${sourceURL}" rel="noreferrer" target="_blank">Open source</a>
              </section>

              <section class="pp-doc-side-card pp-doc-boundary-card">
                <div class="pp-doc-side-label">Product boundary</div>
                <p>${escapeHtml(status?.detail || 'This page is documentation, not a new product or release claim.')}</p>
              </section>
            </aside>
          </div>

          ${renderRelatedNavigation(pageId)}
        </main>
        ${renderFooter()}
      </div>
    </div>
  </body>
</html>
`;
  return html.replace(/[ \t]+$/gm, '');
}

function renderFeatureVisual(page) {
  const specs = {
    hub: ['Request', 'Path', 'Machine', 'Transfer'],
    install: ['Channel', 'Checksum', 'Binary'],
    grpc: ['Schema', 'RPC', 'Evidence'],
    http: ['Request', 'TLS', 'Response'],
    'learn-grpc': ['Contract', 'Stream', 'Status'],
    network: ['DNS', 'Route', 'Hop', 'Evidence'],
    'network-boundary': ['Passive', 'Active', 'Imported'],
    'this-pc': ['Local', 'Public', 'Quality'],
    tunnels: ['Host + version', 'OS service', 'Config + routes'],
    downloader: ['Queue', 'Control', 'Verify'],
    security: ['DNS', 'TLS', 'HTTP'],
    settings: ['Browser', 'Bridge', 'Host'],
    roadmap: ['Shipped', 'Next', 'Gated'],
    architecture: ['Shell', 'Adapter', 'Evidence'],
    research: ['Observe', 'Compare', 'Decide'],
    extension: ['Proto file', 'Launch', 'Workbench'],
  };
  const nodes = specs[page.visual] || page.highlights || ['Start', 'Observe', 'Decide'];
  const visualId = `visual-${page.id}`;
  const nodeWidth = nodes.length === 4 ? 88 : 116;
  const gap = nodes.length === 4 ? 14 : 20;
  const start = nodes.length === 4 ? 14 : 20;
  const centers = nodes.map((_, index) => start + nodeWidth / 2 + index * (nodeWidth + gap));
  const lines = centers
    .slice(0, -1)
    .map(
      (center, index) =>
        `<path class="pp-visual-link" d="M ${center + nodeWidth / 2 - 6} 94 H ${centers[index + 1] - nodeWidth / 2 + 6}" />`
    )
    .join('');
  const nodeMarkup = nodes
    .map((node, index) => {
      const x = start + index * (nodeWidth + gap);
      return `
        <g class="pp-visual-node">
          <rect x="${x}" y="56" width="${nodeWidth}" height="76" rx="10" />
          <circle cx="${x + 18}" cy="75" r="5" />
          <text x="${x + 14}" y="108">${escapeHtml(node)}</text>
        </g>
      `;
    })
    .join('');

  return `
    <figure class="pp-doc-visual pp-visual-${escapeAttr(page.visual)}">
      <div class="pp-doc-visual-heading">
        <span>Evidence path</span>
        <strong>${escapeHtml(page.question || page.title)}</strong>
      </div>
      <svg viewBox="0 0 420 172" role="img" aria-labelledby="${visualId}-title ${visualId}-description">
        <title id="${visualId}-title">${escapeHtml(page.title)} evidence path</title>
        <desc id="${visualId}-description">${escapeHtml(nodes.join(' to '))}</desc>
        ${lines}
        ${nodeMarkup}
      </svg>
      <figcaption>One local path. Each boundary stays visible.</figcaption>
    </figure>
  `;
}

function renderTopbar() {
  return `
    <header class="pp-doc-topbar">
      <a class="pp-doc-brand" href="${siteBase}/" aria-label="ProtoPeek home">
        <span class="pp-doc-brand-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32"><path d="M3.5 17h4l2.2-9 4.1 17 4.4-19 3.1 12H28.5"/><circle cx="28.5" cy="18" r="1.6"/></svg>
        </span>
        <strong>ProtoPeek</strong>
      </a>
      <nav class="pp-doc-nav" aria-label="Primary">
        <a href="${siteBase}/#product">Product</a>
        <a href="${siteBase}/docs/" aria-current="page">Guides</a>
        <a href="${siteBase}/install/">Download</a>
        <a href="${repoRootURL}" rel="noreferrer" target="_blank">GitHub ${externalIcon()}</a>
      </nav>
    </header>
  `;
}

function renderBreadcrumb(title, canonicalPath) {
  const current =
    canonicalPath === '/docs/' ? '' : `<span aria-current="page">${escapeHtml(title)}</span>`;
  return `
    <nav class="pp-breadcrumb" aria-label="Breadcrumb">
      <a href="${siteBase}/">Home</a>
      ${arrowIcon()}
      ${canonicalPath === '/docs/' ? '<span aria-current="page">Guides</span>' : `<a href="${siteBase}/docs/">Guides</a>${arrowIcon()}${current}`}
    </nav>
  `;
}

function renderStatus(status, variant = 'full') {
  if (!status) return '';
  return `
    <span class="pp-page-status is-${escapeAttr(status.tone || 'guide')} is-${escapeAttr(variant)}">
      <i aria-hidden="true"></i>${escapeHtml(status.label)}
    </span>
  `;
}

function renderFlow(flow) {
  if (!flow?.length) return '';
  return `
    <section class="pp-feature-flow" aria-label="Three-step feature path">
      ${flow
        .map(
          (step, index) => `
            <article>
              <span>${String(index + 1).padStart(2, '0')} · ${escapeHtml(step.verb)}</span>
              <h2>${escapeHtml(step.title)}</h2>
              <p>${escapeHtml(step.detail)}</p>
            </article>
          `
        )
        .join('')}
    </section>
  `;
}

function renderRelatedNavigation(pageId) {
  if (!pageId || pageId === 'docs') return '';
  const index = hubPages.findIndex((page) => page.id === pageId);
  if (index < 0) return '';
  const previous = hubPages[index - 1] || hubPages.at(-1);
  const next = hubPages[index + 1] || hubPages[0];
  return `
    <nav class="pp-related-navigation" aria-label="Related ProtoPeek guides">
      <a href="${previous.path}">
        <span>${arrowIcon('back')} Previous guide</span>
        <strong>${escapeHtml(previous.title)}</strong>
      </a>
      <a href="${next.path}">
        <span>Next guide ${arrowIcon()}</span>
        <strong>${escapeHtml(next.title)}</strong>
      </a>
    </nav>
  `;
}

function renderFooter() {
  return `
    <footer class="pp-doc-footer">
      <div>
        <strong>ProtoPeek</strong>
        <p>Built by <a href="https://shreyam1008.com.np/" rel="noreferrer" target="_blank">Shreyam Adhikari</a>.</p>
      </div>
      <nav aria-label="Footer">
        <a href="${siteBase}/docs/">Guides</a>
        <a href="${siteBase}/install/">Download</a>
        <a href="${repoRootURL}/releases/tag/v0.5.0" rel="noreferrer" target="_blank">Release notes</a>
        <a href="${repoRootURL}" rel="noreferrer" target="_blank">GitHub</a>
      </nav>
    </footer>
  `;
}

function arrowIcon(direction = 'forward') {
  return `<svg class="pp-inline-icon${direction === 'back' ? ' is-back' : ''}" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12M11 5l5 5-5 5"/></svg>`;
}

function externalIcon() {
  return '<svg class="pp-inline-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M11 4h5v5M16 4l-7 7"/><path d="M14 11v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4"/></svg>';
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

function escapeXml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function isExternal(href) {
  return /^https?:\/\//.test(href);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
