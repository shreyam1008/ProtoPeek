# Cap’n Proto workbench

Available in current source after v0.5.0 at **Inspect → Cap’n Proto**. This is a native
Cap’n Proto RPC client for a connection's bootstrap capability, implemented in Go.

## Load a schema, then make a call

1. Choose your `.capnp` files together and select the root file, or paste a single source schema.
   Source loading uses `capnp` from the ProtoPeek host's PATH. The compiler is optional and is
   installed separately using the [official setup guide](https://capnproto.org/install.html).
2. Without a compiler on the ProtoPeek host, load an unpacked binary CodeGeneratorRequest (`.bin`)
   generated on another machine. For example, in a shell with binary-safe redirection:

   ```sh
   capnp compile -o- service.capnp > service.bin
   ```

   Windows PowerShell 5 redirection converts native stdout to text: use `cmd.exe` or PowerShell
   7.4+ for this binary output, as described in [Microsoft's redirection guide](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_redirection).
   Compiling before upload also handles nested imports conveniently.
3. Select a method in the left list. Loading a schema does not connect to a peer.
4. Enter `host:port` (or `[IPv6]:port`), choose TCP or verified TLS, and enter request JSON.
   Omitted fields use schema defaults. Expand **Parameter fields** to see names and types.
5. Click **Call method**. Inspect JSON, elapsed time, the connected address and TLS version.
   Copy the response or save a JSON report. Cancel stops waiting and closes the connection;
   a request already delivered to the service may still have taken effect.

TLS verifies both the certificate chain and server identity. Advanced controls accept a server
name override and additional CA certificates. Verification cannot be disabled. Each call opens
one connection and has a configurable 0.1–30 second deadline; calls are never automatically retried.

## JSON representation

| Schema value | Request and response representation |
| --- | --- |
| Struct or group | Object using schema field names; unknown names are errors |
| Int64 / UInt64 | Exact decimal strings recommended; unquoted request integers also preserve all digits; responses always use strings |
| Other integers | JSON numbers within the schema type's range |
| Float | JSON number, or strings `NaN`, `Infinity`, `-Infinity` |
| Enum | Enumerant name or numeric value |
| Text / Data | UTF-8 string / base64 string |
| List | JSON array, including nested lists and structs |
| Union | At most one member in the request object |
| Capability / AnyPointer | Null input only; non-null responses are labeled opaque, not followed |

Schemas, TLS CA input, requests and responses stay in memory for the open page. They are not
saved as profiles. Reloading clears them. The local server receives schema and request bytes;
only an explicit call sends the encoded request to the chosen endpoint.

## Bounds and compatibility

Source upload accepts at most 32 files / 512 KiB, with imports restricted to supplied files;
embedded files and access to other host files are rejected. Compiled schemas are at most 2 MiB,
1,024 nodes and 256 methods. JSON requests and results are limited to 64 KiB. Wire messages,
allocation, traversal depth, list size, compiler runtime and simultaneous work also have bounds.

Concrete bootstrap methods, defaults, unions, groups, nested structs and lists have fixture
coverage. Encoding is checked against output from the official C++ compiler. TCP and TLS RPC
tests use a real Go peer; a C++ RPC peer has not yet been part of this acceptance pass.
Generic interface/method bindings, returned-capability workflows and pipelining are not supported.
Cap’n Proto is not HTTP or gRPC and does not supply an HTTP-style header editor.

The Go RPC runtime is embedded. The C++ source compiler is not bundled. Dependency license texts
are included in release archives; see `THIRD_PARTY_NOTICES.md` in the repository.
