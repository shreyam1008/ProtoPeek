# Website analysis and security boundary

Status: one passive historical-name lookup and one direct website observation ship in v0.5.0.
Current source after v0.5.0 also derives a bounded, copyable evidence report from that retained
response without making another request. Broader website plans, active findings, and selected-port
handoffs remain planned.

ProtoPeek helps a user understand a website from the perspective of the local ProtoPeek process.
It must not become an ambient Internet scanner, a security-score generator, or an automated
exploitation tool. This document separates the current build from later safety requirements.

## Current build

### Historical certificate-name candidates

The user enters one hostname and must explicitly acknowledge that its normalized registrable apex
will be sent to the named third party `crt.name`. The adapter then:

- sends one bounded request to the fixed `https://crt.name/v1/search` endpoint;
- allows at most two concurrent client requests and is also wired behind a two-operation process
  admission limit;
- uses an eight-second timeout, a 256 KiB response-body limit, at most 256 retained candidates, a
  15-minute cache, and at most 32 cache entries by default;
- suffix-checks, IDNA-normalizes, deduplicates, sorts, and bounds candidate names;
- retains only each normalized name and whether it was a wildcard pattern; the provider adapter
  does not return per-candidate observation dates;
- never resolves, probes, scans, or opens a returned candidate.

`crt.name` is a historical certificate-name index, not proof that a returned name is live, owned,
still configured, or independently deployed. Wildcards remain patterns. DNS has no universal
“list every subdomain” operation, and this adapter does not use `ANY`, attempt AXFR, brute-force
labels, or fan out across returned names.

### One public website response

Website observation has a separate acknowledgement because it contacts the target and may create a
server log. Each accepted operation performs exactly one credential-free `HEAD` request:

- absolute HTTP or HTTPS only; user information, query strings, and fragments are rejected;
- the hostname is normalized with the IDNA lookup profile;
- DNS is resolved once, at most eight answers are retained by default, and every answer must be an
  ordinary public address; mixed public/blocked results fail closed;
- dials use only the validated numeric pin set while the original hostname remains the HTTP Host,
  TLS SNI, and certificate-verification name;
- environment proxies are disabled, compression and keep-alives are disabled, and HTTPS uses
  verified TLS 1.2 or newer;
- redirects are returned as bounded evidence but never followed or resolved;
- no cookie, authorization header, request body, retry, or response-body read is used;
- the default whole-operation wall is 15 seconds and the outer process admits at most two website
  observations concurrently;
- the result retains the observed URL, complete pinned address set, bounded selected headers,
  status/protocol, safe redirect location, successful TLS certificate evidence when HTTPS applies,
  and DNS/connect/TLS/first-byte/total timing where observed.

The result is one source-perspective observation at one time. A missing header, failed request,
redirect, hostname, route, or timing value is not a universal vulnerability verdict. ProtoPeek does
not emit a security score and does not infer a CVE from a `Server` header.

### Current source after v0.5.0: local HEAD evidence report

This source-only refinement is not part of the published v0.5.0 release. After one successful
website observation, the Security page now runs a pure deterministic analyzer over the already
retained result. It makes no DNS lookup, HTTP request to the target or a third party, redirect
follow, body read, crawl, login attempt, or port connection.

The report uses only `observed`, `not observed`, and `attention` labels for:

- HTTPS, verified TLS-chain evidence, and certificate validity at the observation time;
- `Strict-Transport-Security`, `Content-Security-Policy`, `X-Content-Type-Options`,
  `Referrer-Policy`, and `Permissions-Policy` response-header evidence;
- frame-embedding evidence from CSP `frame-ancestors` or `X-Frame-Options`;
- retained `Server` disclosure without treating a product string as a vulnerability;
- the requested HTTP/HTTPS scheme and any retained redirect location, without following it.

The user can copy a versioned JSON report containing the normalized observation, fixed one-HEAD
boundary, derived labels, and source-field references. Header names and duplicate values are
canonicalized for deterministic output; the original selected evidence remains bounded by the
observer and UI response limits. No score, grade, pass/fail state, CVE, or exploit claim is added.

These labels describe only the retained response to one non-following `HEAD` request. `HEAD`
evidence can differ from `GET` responses and application behavior. `Not observed` means absent from
this retained response, not absent from every route, method, browser session, CDN path, or future
response. `Attention` identifies evidence that needs human interpretation; it is not a vulnerability
verdict.

### Shared destination guard

Both current adapters use public-only pinned transports for their outbound website/provider
request. The guard blocks loopback, RFC1918/RFC4193 private, link-local, shared/CGNAT, multicast,
unspecified, documentation, benchmarking, protocol-assignment, and reserved ranges. IPv4-mapped
IPv6 is unmapped before classification. A dial for any authority outside the approved pin set is
refused.

CSRF protects loopback browser mutations, but it is not user authentication and does not weaken the
destination policy. Nothing runs on page load.

## Planned, not shipped

The current Security page labels these ideas as planned. None is a current API or product claim:

- user-selected DNS record observation beyond the DNS evidence already required to pin one HEAD;
- multi-request website plans, optional GET, HTTP-to-HTTPS upgrade checks, `security.txt`, cookies,
  HTML or form inspection, or any redirect-following plan;
- multi-page or multi-request findings, scheduled comparisons, and broader report formats;
- public selected-port handoff or automatic fan-out across historical names;
- ASN, GeoIP, ownership, provider, or physical-path enrichment;
- authenticated crawling, browser automation, or scheduled monitoring.

Any later multi-request or active plan must show the exact target, methods, paths, ports, request
count, concurrency, deadlines, redirect policy, and stop control before fresh authorization. Editing
the plan invalidates that authorization. Consent must never become a persistent global preference.

## Authorization tiers for future work

1. **External intelligence** — explicit request to a named provider and clear disclosure of what is
   sent. The current `crt.name` adapter is in this tier.
2. **Direct observation** — bounded DNS, verified TLS, and a fixed safe HTTP request to the target.
   The current one-HEAD observer is the only shipped website plan.
3. **Authorized active probes** — selected ports, path probes, private discovery, multiple requests,
   or multiple targets. Existing Network tools keep their own authorization; no new website-tier
   active probe is shipped.
4. **Intrusive testing** — outside the core product.

## Excluded behavior

ProtoPeek core does not perform password guessing, spraying, credential stuffing, authentication
bypass, injection payloads, account creation, state-changing requests, directory brute force,
`.git`/`.env`/admin/backup probing, login testing, CORS payload matrices, exploit verification,
denial-of-service, or authenticated crawling.

An open TCP port would prove only a listener, not a named application protocol. A hostname, route,
or source-to-responder RTT would not prove a country, datacenter, provider, owner, physical cable
path, or adjacent-link latency.

## Evidence and test contract

Current tests must continue to prove explicit disclosure/consent, IDNA and public-suffix
normalization, special-range and mixed-answer rejection, resolve-once pinned dialing, proxy bypass,
no redirect follow, no body read, verified TLS behavior, fixed request method, provider/target
timeouts, body/name/header limits, cancellation, admission saturation, malformed provider results,
cache bounds, and that candidate names are never contacted. Current-source UI tests additionally
prove deterministic case-insensitive header analysis, duplicate-value handling, invalid certificate
dates, HTTP without TLS, missing headers, absolute and relative redirect interpretation, fixed
status vocabulary, clipboard failure handling, and that copying the JSON report causes no second
target-observation request.

Future features require their own tests for plan invalidation and for every additional request,
redirect, body, port, credential, persistence, and export boundary before they can move out of the
planned section.
