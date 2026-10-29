# Q&A — Redact + Next upgrade: integration

> **Module**: redact
> **Category**: integrations
> **Last updated**: 2026-10-27

Source of the decisions below: the user's instruction ("start implementing the new
package from tanstack … also update to the latest version of nextjs for all apps"),
plus the constraints measured while implementing it.

---

## Scope — which apps adopt Redact

**Q**: Which Next apps get the Redact browser runtime?

**A**: Both — `apps/web` and `apps/doc`. Redact replaces React only in the
browser; Next keeps React for SSR, Server Components, Flight and action
transport, so the integration is a config wrapper per app. `apps/api`,
`apps/api-services` and `apps/setup` are NestJS and are untouched.

---

## Version — exact Next pin, not a caret

**Q**: Bump Next to `^16.4.3` or pin it?

**A**: Exact `16.4.3` in the `next` catalog. `@tanstack/redact@0.2.1` declares
`next: ~15.5.0 || ~16.0.0 || ~16.1.0 || ~16.2.0 || ~16.3.0 || ~16.4.0` and
`withRedact` throws at config load outside `/^(?:15\.5|16\.[0-4])\.\d+$/`. A
caret would let `bun install` resolve 16.5 and break every `next dev`/`next
build`. `eslint-config-next` and `@next/bundle-analyzer` follow the same pin.

Measured: npm `latest` is `16.4.3` (the security fix) and it is one of the six
patches Redact pins in its release matrix, so "latest + supported" coincide.

---

## Features kept enabled

**Q**: Do `cacheComponents`, `partialPrefetching` and `reactCompiler` stay on?

**A**: Yes. Redact's Next matrix covers Next 16 with Cache Components enabled
and disabled, and it ships `react/compiler-runtime` for React Compiler output.
The adapter loads with all three enabled (measured: `next.config.ts` resolves in
361 ms, then `Cache Components enabled`, `Partial Prefetching enabled`,
`turbopackRustReactCompiler`).

---

## Verification boundary

**Q**: Is a host-side `next build` of `apps/web` expected to pass?

**A**: No, and that is pre-existing. On the host `bunfig.toml` sets
`globalStore = true`, so `node_modules/.bun/**/node_modules/<pkg>` are absolute
symlinks into `~/.bun/install/cache/links/...`. `apps/web`'s `turbopack.root` is
the repository root, so Turbopack refuses to follow them and reports ~1.2k
`Module not found`. Docker builds install with `BUN_INSTALL_GLOBAL_STORE=0`,
which materialises real directories inside the image.

Verified instead: `apps/doc` builds end-to-end and its client chunks contain the
Redact runtime (`_redactFiber`, `_redactOwner`); `apps/web` resolves its config
with the adapter and passes `type-check`.
