# Product domain and release contract

Target canonical URL: `https://protopeek.shreyam1008.com.np/`  
Current state: **Prepared; deployment and public checks pending**

## Safe activation

1. Push the verified repository changes and confirm the existing `docs/` Pages
   source still deploys at the legacy GitHub Pages URL.
2. Save `protopeek.shreyam1008.com.np` as the repository Pages custom domain.
3. Add one DNS-only CNAME from `protopeek.shreyam1008.com.np` to
   `shreyam1008.github.io`; remove any conflicting record for that exact host.
4. Wait for GitHub's DNS and certificate checks, then enforce HTTPS.
5. Rebuild the site so canonical, Open Graph, robots, sitemap, assets, and
   internal links all use the custom origin.
6. Verify the legacy GitHub Pages URL redirects to the same custom-domain path.
7. Only then change the website distribution status to **Live**.

## Rollback

Remove the DNS CNAME first, then remove the GitHub Pages custom-domain setting.
Restore the legacy canonical source only if the custom domain is abandoned,
rebuild `docs/`, and verify the legacy Pages URL before closing the incident.
