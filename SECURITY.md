# Security policy

Report vulnerabilities privately through GitHub Security Advisories for
`shreyam1008/ProtoPeek`. Do not include credentials, private protos, service
addresses, request data, or production metadata in a public issue.

ProtoPeek is a local debugging console, not an authenticated remote service. Its
web listener binds to loopback by default. Non-loopback binding requires the
explicit `-unsafe-allow-remote` flag and must be placed behind a trusted access,
TLS, and authentication boundary.
