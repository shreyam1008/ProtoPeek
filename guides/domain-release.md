# Product domain and release contract

Canonical URL: `https://protopeek.shreyam1008.com.np/`

## Verified hosting state · 23 October 2026

The custom domain is live over HTTPS. Cloudflare Pages successfully deployed merged master
[`c0e0e405`](https://github.com/shreyam1008/ProtoPeek/commit/c0e0e405b90e57bc8e470c1cc427371804964743)
through the installed Cloudflare Git integration. Its deployment check identifies the `protopeek`
project; no local Cloudflare credential change or manual upload was needed.

Anonymous HTTP verification found all 23 committed prerendered routes returning 200 with
server-rendered headings and matching custom-domain canonicals. The site's JavaScript, CSS,
sitemap, manifest, robots, Markdown and manual assets matched the committed output by SHA-256.
Cloudflare adds its own scripts to HTML; after isolating those additions, route content matched
the committed documents. This HTTP verification does not replace browser interaction testing.

The legacy `https://shreyam1008.github.io/ProtoPeek/` URL returned **404**, without redirecting.
It is not an established compatibility redirect. Use the custom domain in install commands,
canonical links and public documentation; do not claim the legacy path forwards users.

Website deployment, GitHub release publication and package-channel promotion are separate.
The v0.7.0 build description does not establish published archives, a promoted Homebrew/Scoop/APT
manifest, or Store/Snap/WinGet approval. Default installers resolve the
[latest published stable release](https://github.com/shreyam1008/ProtoPeek/releases/latest).

Historical record: v0.5.0's stable release, Pages site, Homebrew tap and Scoop bucket were
externally verified on 24 August 2026. That dated evidence is not the current release version.

## Verification after a website deployment

1. Confirm the custom-domain homepage and every sitemap route return HTTPS 200.
2. Record the actual legacy GitHub Pages response separately. The 23 October check returned 404;
   only describe a compatibility redirect after verifying its status and matching destination.
3. Confirm canonical, Open Graph, robots, sitemap, manifest, and structured data
   use the custom origin.
4. View the raw homepage response and confirm product copy is prerendered inside
   `#root` before JavaScript runs.
5. Validate the 1200 by 630 PNG social card and its alt metadata.
6. Confirm install commands resolve the latest published stable release, with Nightly explicitly
   opt-in. After a release promotion, verify download URLs, archive/checksum identity and actual
   installation independently; a successful site deployment does not prove those operations.

## Search indexing handoff

Search Console is an owner-account operation and is not inferred from a successful Pages deploy.
After a release, Shreyam should verify the custom-domain property, submit
`https://protopeek.shreyam1008.com.np/sitemap.xml`, and request indexing for the homepage and
Downloader page. Record the submission date and any coverage error in the distribution log;
do not describe indexing as complete until Search Console reports the custom URLs as discovered or
indexed. Recheck search impressions after two weeks, while treating ordinary crawl delay as external
state rather than changing working canonical metadata without evidence.

## Rollback

For a bad site build, restore the previous known-good `docs/` artifact set through a reviewed
source change and verify the automatic Pages deployment on that exact commit. Recheck the custom
domain and record the legacy URL response separately. Change DNS or the Pages custom-domain
setting only for a domain-level incident; preserve the current CNAME and HTTPS
configuration during ordinary application rollbacks.
