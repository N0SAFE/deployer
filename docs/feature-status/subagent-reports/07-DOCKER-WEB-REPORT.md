# Docker — Web Layer (Subagent 2/3)

## Pages: 10 active + 3 redirects
- **10 pages use real domain hooks** ✅ (containers, images, networks, volumes, stacks, registry, logs, activity, shell, overview)
- **3 pages redirect** (events→activity, terminal→shell, queu→activity)
- **0 pages use mock data for primary content** ✅

## Domain Hooks: 73 total
- `hooks.ts`: 56 exports (51 `use*` hooks + 2 builders + 1 component)
- `use-docker-live.ts`: 7 SSE live hooks (containers, images, networks, volumes, entities, refetch)
- `mock-hooks.ts`: 11 mock hooks (dead — Phase 1 deletion)

## Components: 34 in `_components/`
- 8 modals: 2 with Trigger+Content split ✅, 5 monolithic ⚠️, 1 utility
- 5 modals import supplementary mock data
- Typo: `queu/` directory (should be `queue/`)

## Issues
- 6 `as unknown as` violations in `use-docker-live.ts`
- 5 components with mock data imports
- 1 typo in directory name

## Action Items
1. [S] Fix `queu/` → `queue/` directory name
2. [M] Eliminate 6 `as unknown as` in `use-docker-live.ts` — use Zod parse
3. [M] Replace mock data in 5 modal components with real API calls
4. [L] Split 5 monolithic modals into Trigger+Content pattern
5. [S] Remove mock-hooks.ts (Phase 1)
