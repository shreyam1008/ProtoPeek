# HTTP workbench

Current source places request settings and response evidence in vertical tabs beside the editors.
Request and response remain visible together at desktop widths; narrow screens expose a pane
switch. Arrow Up/Down navigates each side list.

ProtoPeek sends one bounded HTTP or REST request through the local Go process and keeps request choices, transport evidence, and the response together. The workbench ships in stable v0.5.0.

## Make your first request

Open **Inspect → HTTP**, paste the full URL, and choose **Send**. Status, body, headers and timing
appear beside the request. No account, collection or discovery scan is needed first.

In matching current source, choose **HTTP request** on Home, paste the URL, and select **Open HTTP**.
The full path and query prepare an unsent draft; Send remains explicit. **Find a service instead** is a
separate discovery action. Existing unsent work follows the workbench’s draft-recovery rules.

## Build one explicit request

Choose the method and an absolute `http://` or `https://` URL. Add duplicate query parameters, headers, live auth, a raw body, timeout, and redirect policy only when the request needs them.

The live editor can hold credentials for the request you intend to send. Automatic history strips URL user information, redacts credential-like query values, keeps only a small non-sensitive header allowlist, and never persists the request body.

## Start from an API definition

Current source can import an explicit OpenAPI 3.x or Swagger 2.0 JSON definition from a local file or URL. A Swagger UI or Scalar page URL also works when the page exposes a linked JSON definition. Import adds a searchable operation rail and leaves the current request intact. Choose an operation to replace the method, URL, parameters, headers, and example body. Replacing a request cancels its active operation and clears its previous response.

URL imports travel through the same bounded local HTTP relay as other requests. The imported document is capped at 2 MiB and 1,000 operations. YAML, automatic endpoint discovery, code generation, and persisted API collections are deliberately outside this focused slice.

## Keep transport choices visible

TLS verification is on by default. Redirect following is off by default. If redirects are enabled, ProtoPeek retains the bounded redirect chain and refuses unsafe policy changes such as an HTTPS downgrade.

The local relay applies explicit limits to URLs, headers, bodies, timeouts, redirects, response size, and concurrent HTTP work. Cancellation ends the local operation instead of leaving a hidden request running in the browser.

Current-source run shortcuts apply only inside the request controls. Repeated key events,
input composition, and shortcuts in import panels or dialogs do not send or cancel requests.
Leaving the HTTP tool cancels an active request.

## Read the response as HTTP

Current source labels each result with the method and sanitized URL that actually ran. Editing
the draft keeps that label attached to the result and shows an editor-changed notice. Credentials
remain in memory for execution; the result label uses the same redaction as automatic history.

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

### Current-source saved requests

**Saved requests** opens a left-side library for reusable HTTP requests. Name the current request
and choose **Save new**, or **Update selected** to replace the selected recipe. The library keeps
the method, URL, query fields, non-sensitive headers, body mode, timeout and redirect choice.
Credential-like values are removed, while empty parameter names remain available for re-entry.
Auth fields are never saved. **Include this request body** is an explicit option; included body
text is saved verbatim and should not contain secrets you want kept only in memory.

Loading a recipe fills the editor and clears old response/auth state without sending a request.
Global **Ctrl+K** search also finds saved requests by name, method and sanitized URL, even from
another workspace. Choosing a result prepares the request; **Send** remains a separate action.
Use the library filter, Delete, Export library or Reset library to manage stored recipes.

Storage belongs to this browser origin: at most 50 recipes / 512 KiB total and 64 KiB per saved
body. A corrupt/full/unavailable store produces an error and is not overwritten by a failed save.
Other tabs refresh the list when browser storage changes. Closing/reopening the browser preserves
the library on the same origin; it is not an account or a host-wide database.

### Current-source additions · 22 October 2026

These additions require a matching current build; the stable v0.6.1 behavior and earlier acceptance
records do not establish their release or native acceptance.

Choose **Manage environments** to create a profile, add variables, and save it, then select it in
**Environment**. Use `{{name}}` in the URL, query fields, headers or body. Missing variables fail
before sending; nested templates are rejected. Secret variables are accepted only in auth/header
values. Their values stay in the open HTTP session and must be re-entered after leaving or reload;
only names/secret flags and non-secret values persist. The store allows 20 profiles, 32 variables
per profile and 128 KiB total. Export and saved recipes do not expand live secret values.

In **Saved requests**, choose **Import request library**, inspect the preview, then choose Merge
or Replace and **Import library**. Imported credentials are removed; included bodies are imported
verbatim, so review them for secrets. The 50-recipe/512 KiB bounds still apply, with no silent
eviction. Import and recipe selection prepare the editor without sending.

**Import cURL** accepts a bounded Copy as cURL (bash/POSIX) subset: one HTTP(S) URL, method, headers,
inline body and timeout, including literal `-b`/`--cookie` values and bounded ANSI-C UTF-8 quoting
(`$'…'`). Choose **Preview request**, review it, then **Load into editor**. The preview discloses
omitted `--compressed`/`Accept-Encoding`: the relay negotiates and decodes gzip rather than copying
browser compression choices. Other content encodings are not decoded. Cookies and auth stay in
memory; bodies are not automatically saved. It never runs a shell or reads cookie/header/body
files. NUL/binary escapes, unsupported flags, proxies and insecure TLS are rejected. **Send** is
separate.

Recent HTTP calls remain local to this browser and preserve a small response summary. Replaying a history entry starts from a clean request state and leaves redacted values blank for deliberate re-entry.

Copy as cURL validates the same prepared request as Send. It preserves the method, duplicate query values, non-sensitive headers, timeout, and body while omitting auth and credential-like headers. Redirect-enabled drafts are refused because a portable command cannot reproduce ProtoPeek’s complete redirect policy.

The copied command runs in your shell. Its DNS, proxy, trust roots, network namespace, cURL version, and implicit headers can differ from the ProtoPeek relay.

## Deliberate limits

### Current-source draft recovery

Unsent HTTP drafts recover in the same browser after navigation or restart. Credential-like query
values and headers are redacted; auth must be entered again. Bodies stay in memory unless
“Remember body in this browser” is enabled. Draft storage is bounded to 256 KiB, and storage failures
are shown in the workbench. JSON responses offer a pretty/raw toggle without changing copied bytes.

For a live WebSocket or SSE connection, use the separate [Event streams workbench](event-streams.md).
Its finite sessions, negotiated subprotocols, event IDs and send/disconnect controls retain their
protocol-specific evidence. The WebSocket/SSE foundation is available in stable v0.6.1.

ProtoPeek does not currently provide automatic OpenAPI endpoint discovery, OpenAPI YAML import, a cookie jar, OAuth application marketplace, mock server, cloud sync, script runner, or team workspace. Those are separate product and security decisions, not implied features.

## Go deeper

- [See how network path evidence stays separate](/network-workbench/).
- [Read the transport and workspace boundary](/transport-boundaries/).
- [Install stable ProtoPeek v0.6.1](/install/).
