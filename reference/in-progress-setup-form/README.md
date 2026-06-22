# Setup Wizard — Reference Implementation

> **Purpose**: Standalone design reference for the multi-step setup wizard.
> **Status**: Mock-based demo (all API calls are simulated).
> **Production version**: `v3/apps/web/src/components/setup/` (connected to real API).

---

## Overview

This directory contains a polished, standalone Next.js app that demonstrates the complete setup wizard UX. It is used as a **design reference** for the real implementation in the web app.

The setup wizard guides the user through:

- **Local instance provisioning** — create admin account, choose database (managed/existing PostgreSQL), run migrations, generate node identity
- **Remote mesh join** — enter mesh URL, authenticate, sync configuration

## What's Here

| Path | Description |
|------|-------------|
| `app/page.tsx` | Root page rendering `<SetupWizard />` |
| `components/setup/` | All wizard components (same structure as web app) |
| `components/setup/setup-wizard.tsx` | Stateful orchestrator managing step transitions |
| `components/setup/steps/*.tsx` | 8 step components (mode, local-account, local-database, local-progress, remote-url, remote-auth, remote-progress, complete) |
| `lib/setup/mock-api.ts` | Simulated API calls with randomized delays |
| `lib/setup/run-task.ts` | Mock task runner with streaming log lines |
| `lib/setup/types.ts` | Shared TypeScript types |
| `lib/setup/wizard-state.ts` | `WizardState` type + `getStepIndex()` helper |

## Local Development

```bash
pnpm install
pnpm dev        # starts on localhost:3000
pnpm build      # static export
```

> **Note**: This app uses mock data — no backend required. For the real setup flow with actual API calls, see `v3/apps/web/src/app/setup/`.

## Relationship to Web App

The real implementation lives in `v3/apps/web/`:

| Reference | Web App Equivalent |
|-----------|-------------------|
| `components/setup/setup-wizard.tsx` | `src/components/setup/setup-wizard.tsx` |
| `components/setup/steps/*.tsx` | `src/components/setup/steps/*.tsx` |
| `lib/setup/types.ts` | `@repo/contracts-entities` (Zod schemas) |
| `lib/setup/mock-api.ts` | `src/domains/setup/endpoints.ts` + hooks |
| `app/page.tsx` | `src/app/setup/page.tsx` |

Key differences:
- Web app uses **real ORPC API calls** via TanStack Query
- Web app receives **SSE events** from `POST /setup/initialize` instead of mock task runner
- Web app uses `@repo/ui` for shadcn components instead of local `components/ui/`
- Web app hooks into `requireAuth()` and Better Auth permissions

## Tech Stack

- Next.js 16.2 + React 19
- Tailwind CSS v4
- shadcn/ui (local `components/ui/`)
- Lucide React icons
