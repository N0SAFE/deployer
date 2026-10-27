# AGENTS.md — @deployer/config-prettier

Shared Prettier configuration.

## Rules
- Keep formatting consistent across the repo.
- Document any non-default decisions in `docs/STYLEGUIDE.md`.

## Formatting runs through `bun fmt`, not the Prettier CLI

Every workspace formats with Bun's built-in formatter:

```jsonc
"prettify":     "bun fmt .",
"format:check": "bun fmt --check ."
```

`bun fmt` reads this package's config natively. `prettier.config.ts` at the repo
root and each workspace's `.prettierrc.ts` are still the source of truth, so there
is deliberately **no `[fmt]` section in `bunfig.toml`**: those four style values
(`tabWidth`, `semi`, `singleQuote`, `trailingComma`) already live in `src/base.ts`,
and a second copy in the bunfig would be a second source of truth that can drift.

Verified before the switch: `bun fmt --check .` reports exactly the same set of
unformatted files as `prettier --check .` in every workspace (checked in all 50,
including `packages/ui/base` where both report the same 561 files), and the output
is byte-identical for `.ts`, `.tsx`, `.json`, `.md`, `.css` and `.mts` — including
the Tailwind class sorting that `src/tailwind.ts` enables, which the built-in
`prettier-plugin-tailwindcss` in Bun reproduces exactly.

Two consequences worth knowing:

- **`prettier` is still a dependency** (of `apps/web`, `tooling/bin-pkg-build`,
  `tooling/dependency-builder` and this package). `bun fmt` replaces the CLI
  invocation, not the config package: a `[fmt]` section *does* override a
  `.prettierrc` file, so the config chain must stay the one that decides.
- **Never add a script named `fmt`.** `bun fmt` delegates to a `package.json`
  script of that name, so a `"fmt"` entry would run instead of formatting. The
  `prettify` / `format` / `format:check` names are what the repo uses and what
  `turbo.json` wires.

`@deployer/config-prettier#build` remains a `dependsOn` of the `prettify` and
`format:check` turbo tasks: `bun fmt` loads `.prettierrc.ts`, which imports
`@deployer/config-prettier/{base,tailwind}` from `dist/`.
