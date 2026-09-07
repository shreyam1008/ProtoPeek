const compiler = process.argv[2] || 'capnp';
const schema = 'internal/capnpwork/testdata/workbench.capnp';
const compiled = Bun.spawnSync([compiler, 'compile', '-o-', schema]);
if (compiled.exitCode !== 0) throw new Error(compiled.stderr.toString());
await Bun.write('internal/capnpwork/testdata/workbench.bin', compiled.stdout);
const encoded = Bun.spawnSync([compiler, 'encode', schema, 'Payload'], {
  stdin: Buffer.from('(enabled = false, signed = -9223372036854775808, unsigned = 18446744073709551615, ratio = -2.25, mode = failed, text = "Hello 世界", data = "raw bytes", child = (label = "nested", count = 7), flags = [true, false], numbers = [-1, 0, 2147483647], names = ["one", "two"], children = [(label = "first", count = 1)], matrix = [[1, 65535], []], selection = "chosen", details = (note = "group", amount = 255))'),
});
if (encoded.exitCode !== 0) throw new Error(encoded.stderr.toString());
await Bun.write('internal/capnpwork/testdata/payload.bin', encoded.stdout);
console.log(`Wrote ${compiled.stdout.length} schema bytes and ${encoded.stdout.length} independent payload bytes.`);
