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

CSRF protection is not authentication. A remote gateway must authenticate the
entire console before forwarding any request; do not expose selected API paths
as an unauthenticated shortcut. In particular, `/api/scan`,
`/api/http/request`, `/api/route/lookup`, `/api/path/trace`, and
`/api/network/discover` can contact targets or inspect network evidence from
the ProtoPeek process. `/invoke/*`, `/api/workspace/invoke/*`, and the health
endpoints can contact configured gRPC services. Even the read-only
`/api/path/capabilities` and `/api/network/capabilities` responses reveal local
runtime or interface metadata.

Keep ProtoPeek's Host, Origin, CSRF, request-size, deadline, and concurrency
checks enabled behind the gateway. Add gateway authentication and per-user
rate limits, and deny the network-path or private-discovery endpoints entirely
unless every authenticated user is authorized to use that network perspective.
The public ProtoPeek website is static and must never proxy these local-console
endpoints.
