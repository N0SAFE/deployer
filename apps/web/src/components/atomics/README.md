# Atomic Components Guide (apps/web)

This folder is the **single source of truth** for reusable UI composition in the web app.

For full project organization rules (routes, `_feature` folders, domains, lib, layouts, dynamic routing), start with:

- `src/README.md`

## Required structure

- `components/atomics/atoms/`
- `components/atomics/molecules/`
- `components/atomics/organisms/`

> Do not add reusable UI in `components/organisms/` or other legacy top-level folders.

---

## Philosophy: responsibilities by layer

### Atoms

Smallest reusable UI units, close to primitives.

**Examples**
- Inputs, labels, chips, icon buttons, tiny search controls
- Single-purpose stateless blocks

**Rules**
- No domain logic
- No network/query orchestration
- Keep props narrow and explicit

---

### Molecules

Composition of a few atoms around a focused interaction.

**Examples**
- Search + filter row
- Labeled field groups
- Toolbar control groups

**Rules**
- Can contain local UI state
- Must remain domain-agnostic
- Should not directly fetch data

---

### Organisms

Feature-capable reusable sections made from atoms + molecules.

**Examples**
- Logs viewer
- Terminal viewer
- Data table sections with toolbars and status states

**Rules**
- Can include interaction logic, view behavior, keyboard/scroll behavior
- Accept data and callbacks from adapters/pages
- Avoid embedding domain formatting rules unless intentionally generic

---

## Where domain-specific mapping goes

Use an **adapter component** in the feature folder (e.g. Docker tab) to map domain data into atomic organism props.

- Domain shaping/formatting/parsing: in adapter
- Reusable rendering/layout behavior: in atomic organism

Example:
- `dashboard/docker/.../logs-tab/index.tsx` maps Docker entries to generic `LogsViewer` lines
- `components/atomics/organisms/logs/logs-viewer.tsx` handles generic logs UX (search/layout/scroll trigger)

---

## Naming conventions

- Component file: `kebab-case.tsx`
- Exported component symbol: `PascalCase`
- Barrel files: `index.ts` per atomic unit folder
- Keep names generic in atomics (e.g. `LogsViewer`, not `DockerLogsViewer`)

---

## Recommended folder template

### Atom

`components/atomics/atoms/<domain>/<name>.tsx`

Optional:
- `index.ts`
- `<name>.spec.tsx`

### Molecule

`components/atomics/molecules/<domain>/<name>.tsx`

Optional:
- `index.ts`
- `<name>.spec.tsx`

### Organism

`components/atomics/organisms/<domain>/<name>.tsx`

Optional:
- `index.ts`
- local helper files if truly shared by that organism

---

## Creation checklist (mandatory)

1. Choose layer correctly: atom vs molecule vs organism
2. Keep component generic and reusable
3. Add/update barrel export in same folder
4. Use feature adapter for domain mapping
5. Replace imports from legacy locations
6. Verify no old path usage remains
7. Run type-check for affected files

---

## Import rules

Preferred imports:
- `@/components/atomics/atoms/...`
- `@/components/atomics/molecules/...`
- `@/components/atomics/organisms/...`

Forbidden for new code:
- `@/components/organisms/...`

---

## Current reference implementations

- Logs
  - Atom: `components/atomics/atoms/logs/logs-search-input.tsx`
  - Organism: `components/atomics/organisms/logs/logs-viewer.tsx`
  - Adapter: `app/dashboard/docker/containers/_components/container-detail-modal/logs-tab/index.tsx`

- Terminal
  - Organism: `components/atomics/organisms/terminal/terminal-viewer.tsx`
  - Adapter: `app/dashboard/docker/_components/container-detail-modal/tabs/terminal-tab.tsx`

---

## Anti-patterns to avoid

- Putting domain parsing in atomics when it can be mapped in adapter
- Creating one-off atomics used in only one line of one screen with no reuse intent
- Skipping barrel exports and deep-importing random internals
- Reintroducing `components/organisms/` as a reusable source

---

## Migration strategy for old components

When migrating legacy UI:

1. Move reusable base UI into `components/atomics/*`
2. Keep adapter behavior in feature folder
3. Replace imports gradually by feature area
4. Delete legacy files/folders once references hit zero
5. Confirm with targeted type-check
