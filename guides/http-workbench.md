# HTTP workbench

ProtoPeek sends one bounded HTTP or REST request through the local Go process and keeps request choices, transport evidence, and the response together. The workbench ships in stable v0.5.0.

## Build one explicit request

Choose the method and an absolute `http://` or `https://` URL. Add duplicate query parameters, headers, live auth, a raw body, timeout, and redirect policy only when the request needs them.

The live editor can hold credentials for the request you intend to send. Automatic history strips URL user information, redacts credential-like query values, keeps only a small non-sensitive header allowlist, and never persists the request body.

## Start from an API definition

Current source can import an explicit OpenAPI 3.x or Swagger 2.0 JSON definition from a local file or URL. A Swagger UI or Scalar page URL also works when the page exposes a linked JSON definition. ProtoPeek loads the first operation into the same request editor and adds a searchable operation rail; choosing another operation updates the method, URL, parameters, headers, and example body without creating a second request system.

URL imports travel through the same bounded local HTTP relay as other requests. The imported document is capped at 2 MiB and 1,000 operations. YAML, automatic endpoint discovery, code generation, and persisted API collections are deliberately outside this focused slice.

## Keep transport choices visible

TLS verification is on by default. Redirect following is off by default. If redirects are enabled, ProtoPeek retains the bounded redirect chain and refuses unsafe policy changes such as an HTTPS downgrade.

The local relay applies explicit limits to URLs, headers, bodies, timeouts, redirects, response size, and concurrent HTTP work. Cancellation ends the local operation instead of leaving a hidden request running in the browser.

## Read the response as HTTP

The response inspector keeps HTTP vocabulary intact:

- status code and status text;
- negotiated HTTP protocol and remote address;
- response headers;
- text or base64 body with byte count and truncation state;
- redirect hops;
- verified TLS summary when HTTPS applies; and
- DNS, connect, TLS, first-byte, and total timing phases when observed.

One phase can be absent when the transport reused a connection or did not expose that boundary. ProtoPeek reports the available evidence instead of manufacturing a complete waterfall.

## Reuse without hiding secrets

Recent HTTP calls remain local to this browser and preserve a small response summary. Replaying a history entry starts from a clean request state and leaves redacted values blank for deliberate re-entry.

Copy as cURL validates the same prepared request as Send. It preserves the method, duplicate query values, non-sensitive headers, timeout, and body while omitting auth and credential-like headers. Redirect-enabled drafts are refused because a portable command cannot reproduce ProtoPeek’s complete redirect policy.

The copied command runs in your shell. Its DNS, proxy, trust roots, network namespace, cURL version, and implicit headers can differ from the ProtoPeek relay.

## Deliberate limits

ProtoPeek does not currently provide cURL import, automatic OpenAPI endpoint discovery, OpenAPI YAML import, a cookie jar, OAuth application marketplace, mock server, cloud sync, script runner, or team workspace. Those are separate product and security decisions, not implied features.

## Go deeper

- [See how network path evidence stays separate](/network-workbench/).
- [Read the transport and workspace boundary](/transport-boundaries/).
- [Install stable ProtoPeek v0.5.0](/install/).
