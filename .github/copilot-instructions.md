# 🎯 AI Coding Agent Instructions

> **Foundation file.** All AI agents working on this repo MUST follow every rule referenced below.
> Violations are bugs, not style choices. When in doubt, read [`AGENTS.md`](../../AGENTS.md) (root) and the nearest scoped `AGENTS.md` first.

This is an **index only**. The detailed rules live in scoped instruction files under
[`.github/instructions/`](./instructions/) — they load automatically based on the files you touch.
Read the ones matching your current task before writing code.

## Instruction Files

| File | Applies To | Contents |
|---|---|---|
| [`core-rules.instructions.md`](./instructions/core-rules.instructions.md) | always | Engineering principles, workflow/process, code-review catalogs, testing & performance |
| [`type-safety-and-contracts.instructions.md`](./instructions/type-safety-and-contracts.instructions.md) | contracts/types/utils/api/web | Type safety (zero assertions), Zod as source of truth, ORPC contracts, package boundaries |
| [`backend-nestjs.instructions.md`](./instructions/backend-nestjs.instructions.md) | api/load-balancer/doc/nest pkg | NestJS patterns, error handling, logging |
| [`frontend-react-uiux.instructions.md`](./instructions/frontend-react-uiux.instructions.md) | web app / ui pkg | React & Next.js patterns, UI/UX standards |

**Non-negotiables regardless of task:** zero type assertions, Zod validates all external data,
ORPC for all data access, logger instead of `console.*`, MCP tools before bash, tests must pass
before commit. Details in the files above.

---

## Architectural Layers at a Glance

```text
## Architectural Layers at a Glance

```text
┌─────────────────────────────────────────────────────────────┐
│  Web (Next.js)                                               │
│  apps/web/src/app/<feature>/{page,layout}.tsx              │
│  apps/web/src/domains/<domain>/hooks.ts                     │
│  apps/web/src/lib/orpc.ts                                   │
└────────────────────────┬────────────────────────────────────┘
                         │ ORPC client (typed)
┌────────────────────────▼────────────────────────────────────┐
│  API (NestJS)                                                │
│  apps/api/src/modules/<domain>/ (product)                   │
│  apps/api/src/system/<domain>/ (control plane)              │
│  apps/api/src/core/ (foundational, app-* wiring)             │
└────────────────────────┬────────────────────────────────────┘
                         │ Internal: Mesh / Drizzle / etc.
┌────────────────────────▼────────────────────────────────────┐
│  Contracts (Zod → ORPC)                                      │
│  packages/contracts/api/modules/<domain>/<op>.ts            │
│  packages/contracts/entities/src/entities/...                │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│  Shared Utilities                                            │
│  packages/utils/orpc/        — ORPC builder helpers         │
│  packages/utils/logger/       — Pino + ContextFilterLogger   │
│  packages/utils/auth/         — Better Auth factories       │
│  packages/configs/eslint/     — Shared ESLint configs       │
│  packages/configs/typescript/ — Shared TS configs          │
│  packages/configs/vitest/     — Shared Vitest configs       │
└─────────────────────────────────────────────────────────────┘
```

---

**Remember**: This file is the source of truth for all AI development on this project. When patterns evolve, update this file **in the same change set** as the code change. Outdated instructions are worse than no instructions.

---```

> Full diagram: see [`.github/instructions/workflow-process.instructions.md`] and `docs/architecture`.

## Graphify

For any question about this repo's architecture, structure, components, or how to add/modify/find
code, your first action should be `graphify query "<question>"` when `graphify-out/graph.json`
exists. Use `graphify path "<A>" "<B>"` for relationship questions and `graphify explain "<concept>"`
for focused-concept questions.

If `graphify-out/wiki/index.md` exists, use it for broad navigation. Only read source files when
modifying/debugging specific code or when the graph lacks the needed detail.

Type `/graphify` in Copilot Chat to build or update the graph.
