# @deployer/effect-infra

Effect infrastructure layers (L0), built on **Bun builtins**. Every layer ships a Live layer **and** a Test layer. Wave Q of `docs/audit-2026-10-25/effect-layers-catalog.md`. Tests run under the Bun runtime (`bun --bun vitest run`).

| Layer | What | Bun builtins used | Test layer |
|---|---|---|---|
| `KeyRing` | HKDF-derived per-purpose, per-generation keys from ONE root secret; refuses weak/placeholder roots at boot; rotation by generation | WebCrypto (`crypto.subtle`) | `KeyRing.test()` |
| `SecretBox` | AES-256-GCM `seal/open/reseal` with key ids and AAD binding (table, column, row, scope) | WebCrypto, `Uint8Array#toBase64`/`fromBase64` | `SecretBox.insecureTest` |
| `SyncSecretBox` + legacy reader | Synchronous twin of `KeyRing`+`SecretBox` for drizzle column codecs (same HKDF derivation, key ids, AAD and `enc:v1:` stored form; interoperable both ways) and a read-only reader for the old `salt:iv:tag:data` form | `node:crypto` (the only Node crypto here: drizzle codecs are sync, WebCrypto is async-only, Bun has no sync AES) | `makeSyncSecretBox({ allowInsecureRoot })` |
| `CommandRunner` | Host commands: no shell, per-consumer allow-list, parent env not inherited, secrets scrubbed, output cap, timeout, process-group kill on interrupt, `stream` | `Bun.spawn`, `Bun.env`, `Bun.sleep` | `CommandRunner.script(rules)` |
| `SafeHttp` + `ip-policy` | Outbound HTTP for untrusted targets: resolve once, validate every answer, connect to that IP with the original name as Host/SNI, per-hop redirect checks, size cap, timeout, no proxy | `Bun.dns.lookup`, `fetch` (`redirect: "manual"`, `tls.serverName`, `proxy: false`) | `SafeHttp.fake(handler)` |
| `makeSafeHttpClient` + `publicEgressMessage` | The Promise edge of `SafeHttp` for Nest islands that are not Effect services yet: throws the tagged errors; `publicEgressMessage` maps them to a caller-safe category. Presets: `EgressPolicy.userSupplied` (public only), `internal`, `operatorTarget` (LAN allowed; loopback, link-local, metadata refused; no redirects); `denyClasses` selects classes exactly | same as `SafeHttp` | inject `resolve` |
| `FileSystem` | Create-only writes, `kindOf` that does not follow symlinks, scoped temp dirs | `Bun.file`, `Bun.write` | `FileSystem.test()` |

Where Bun has no builtin, the code says so: `node:fs/promises` for `lstat`, `mkdir -p`, `readdir`, `realpath`, `rm -r`, `mkdtemp` and the exclusive-create `open`; `process.kill(-pid)` to signal a process group (`Subprocess#kill` only reaches the direct child).

Not wired into the existing callers yet; see roadmap items `EFF-212`, `EFF-240`, `EFF-244`.
