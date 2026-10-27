# `@deployer/config-eslint`

Shared ESLint flat config for the monorepo. `bun lint` loads it in every
workspace; no workspace invokes the ESLint CLI.

See `AGENTS.md` in this folder for the build model (the TypeScript 6 island) and
the `@shadcn/lint` registration.
