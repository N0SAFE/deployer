# 🧪 Features Using Mock Data (DEPRECATED — ALL REMOVED 2026-07-20)

> **All mock data has been removed from the codebase.** The `apps/web/src/mocks/` directory (15 files) was deleted.
> This file is kept for historical reference only.

## Summary

| Metric | Before | After |
|--------|:------:|:-----:|
| Mock import lines | 26 | **0** |
| Mock data source files | 15 | **0** |
| Pages using mock data | ~15 | **0** |

## What Happened to Each Mocked Feature

| Feature | Before (Mock) | After (Real) |
|---------|:-------------:|:------------:|
| Deployments list page | MOCK_DEPLOYMENTS | `useDeploymentList()` with loading/error states |
| Projects list page | MOCK_PROJECTS | `useProjectList()` with real create/update mutations |
| Services list page | 8 mock imports | `useServiceList()` with loading/error states |
| Project detail page | 5 mock imports | Real hooks only |
| Project config pages | 2 mock imports | Real hooks (UI shells — mocks removed) |
| Service sub-pages (11) | 17 mock imports | Removed (UI shells — no API. Mocks cleaned) |
| Docker modals (5) | 7 mock imports | Removed mock-only tabs |
| Docker operations | 2 mock imports | Removed mock-only component section |

## Migration Principles Applied

1. Where real API exists → replaced mock with domain hook
2. Where no real API exists → removed the UI section entirely
3. Mock-only data sources (incidents, notifications, providers, runners) → removed
4. All mock source files → deleted
