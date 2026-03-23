# @repo/poc-core-sync-system

React + Vite proof-of-concept that visually demonstrates how multi-server mesh synchronization works with:

- fleet peer connectivity
- user/org ownership gates
- owner-node discovery and direct routing
- reconnection and failover behavior

## Run

- `bun --bun --cwd=./packages/poc/core-sync-system run dev`
- `bun --bun --cwd=./packages/poc/core-sync-system run build`
- `bun --bun --cwd=./packages/poc/core-sync-system run preview`

## Purpose

This PoC is intentionally isolated from production modules so teams can iterate on sync-flow UX/explanation quickly without impacting runtime code.