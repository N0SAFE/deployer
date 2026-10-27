# @deployer/effect-platform

Effect platform adapters (ports with fakes), built on Bun builtins. Wave Q of `docs/audit-2026-10-25/effect-layers-catalog.md`.

## ArchiveExtractor

Safe extraction of untrusted zip / tar / tar.gz uploads. Pure TypeScript readers (no `unzip`/`tar` binary), containment on the resolved path, every link/device/fifo refused, setuid/setgid/sticky and group/other write bits stripped, create-only writes, hard limits (entries, entry/total size, compression ratio, path length, depth), rollback on failure.

Decompression uses the web-standard `DecompressionStream` with a **hard output cap**, because `Bun.inflateSync`/`gunzipSync` have no limit and would fully allocate a bomb before any size check could run. CRC-32 uses `Bun.hash.crc32`. Hostile-archive fixtures (`Bun.deflateSync`/`gzipSync`) live in `@deployer/effect-platform/testing`.

Limits: the archive is read into memory (bounded by `maxArchiveBytes`); zip names are UTF-8; no zip64, encryption or multi-disk. Not wired into `git.service.ts` yet (roadmap `EFF-242`, `SEC-014`, `DEPLOY-031`).
