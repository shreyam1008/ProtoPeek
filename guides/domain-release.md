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

## Search indexing handoff

Search Console is an owner-account operation and is not inferred from a successful Pages deploy.
After a release, Shreyam should verify the custom-domain property, submit
`https://protopeek.shreyam1008.com.np/sitemap.xml`, and request indexing for the homepage and
feature-roadmap page. Record the submission date and any coverage error in the distribution log;
do not describe indexing as complete until Search Console reports the custom URLs as discovered or
indexed. Recheck search impressions after two weeks, while treating ordinary crawl delay as external
state rather than changing working canonical/redirect metadata without evidence.

## Rollback

For a bad site build, restore the previous known-good `docs/` artifact set and
verify the custom and legacy URLs again. Change DNS or the Pages custom-domain
setting only for a domain-level incident; preserve the current CNAME and HTTPS
configuration during ordinary application rollbacks.
