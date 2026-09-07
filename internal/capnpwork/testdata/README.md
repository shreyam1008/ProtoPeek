# Cap’n Proto interoperability fixtures

`workbench.capnp` defines the concrete test service and representative field types.
`workbench.bin` is the official C++ compiler's unpacked CodeGeneratorRequest.
`payload.bin` is a message encoded independently by that compiler, not by ProtoPeek.
Tests decode it and compare our encoding with its wire value using `capnp.Equal`.

Regenerate from the repository root with Bun and Cap’n Proto 1.5.0:

```sh
bun scripts/regenerate-capnp-fixtures.ts /path/to/capnp
```

This writes binary stdout directly, avoiding shell text-redirection conversions on Windows.
Go unit tests do not require the compiler. Set `PROTOPEEK_CAPNP_COMPILER` to an absolute compiler
path to also run optional source-compilation integration tests.
