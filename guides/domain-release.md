# Product domain and release contract

Canonical URL: `https://protopeek.shreyam1008.com.np/`

Current public state: **Live over HTTPS**

v0.3.0 release state: **Published stable and deployed**

## Verification after a website deployment

1. Confirm the custom-domain homepage and every sitemap route return HTTPS 200.
2. Confirm `https://shreyam1008.github.io/ProtoPeek/` redirects to the matching
   custom-domain path.
3. Confirm canonical, Open Graph, robots, sitemap, manifest, and structured data
   use the custom origin.
4. View the raw homepage response and confirm product copy is prerendered inside
   `#root` before JavaScript runs.
5. Validate the 1200 by 630 PNG social card and its alt metadata.
6. Confirm the install copy still resolves the public stable release, not a
   draft or edge release.

## Rollback

For a bad site build, restore the previous known-good `docs/` artifact set and
verify the custom and legacy URLs again. Change DNS or the Pages custom-domain
setting only for a domain-level incident; preserve the current CNAME and HTTPS
configuration during ordinary application rollbacks.
