# Security policy

Report vulnerabilities privately through GitHub Security Advisories for
`shreyam1008/ProtoPeek`. Do not include credentials, private protos, service
addresses, request data, or production metadata in a public issue.

ProtoPeek is a local debugging console, not an authenticated remote service. Its
web listener binds to loopback by default. `-allow-non-loopback-bind` exists for
a container listener whose outer host port is published only on loopback; it
retains the loopback request Host and Origin policy that blocks browser DNS
rebinding. It is not a remote-access mode. `-unsafe-allow-remote` additionally
accepts non-loopback browser Hosts and must be placed behind a trusted TLS,
authentication, and rate-limit boundary.

CSRF protection is not authentication. In remote mode, `/api/scan`,
`/api/route/lookup`, HTTP relay, and RPC invocation let an authenticated user
contact targets or inspect network evidence from the ProtoPeek process. Add
gateway authentication and rate limits, and expose the container only to users
who are trusted with that network perspective. The public ProtoPeek website is
static and must never proxy these local-console endpoints.
