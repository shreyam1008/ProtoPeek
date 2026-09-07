# Development checks

This separate module builds the predeclared-name checker with `golang.org/x/tools` v0.49.0.
The upstream command pins an older type importer that cannot read Go 1.27 export data.
Keeping the override here makes `make ci` work with current Go without adding tool dependencies
to ProtoPeek's runtime module or release binary. `make predeclared` builds this module's pinned
command, then runs it from the repository root.
