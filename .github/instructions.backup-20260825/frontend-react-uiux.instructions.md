---
applyTo: "apps/web/**, packages/ui/**"
description: "React/Next.js patterns and UI/UX standards for web surfaces"
---

## 🔴 React / Next.js Patterns

### App Router Conventions

- **Routes**: `apps/web/src/app/<feature>/page.tsx` co-located with `page.info.ts`.
- **Layouts**: `apps/web/src/app/<feature>/layout.tsx` for shared chrome.
- **Loading**: `loading.tsx` (Suspense boundary).
- **Error**: `error.tsx` (Error boundary).
- **Declarative routing**: never raw `href` strings, never `fetch()`. Use `import { X } from "@/routes"` then `<X.Link>` or `X.fetch()`. **Regenerate routes after any change**: `bun --bun run web -- dr:build`.

### Feature-Local Structure (mandatory for non-trivial routes)

```text
app/<feature>/
  _models/        — Zod schemas + inferred types (e.g. xxx-input.schema.ts)
  _hooks/         — local hooks (page-level)
  _components/    — local components
  _data-table/    — columns.tsx, filter-config.ts
  _utils/         — pure helpers
```

Filters in `_data-table/filter-config.ts`, columns in `_data-table/columns.tsx`, schemas in `_models/`.

### Information Presentation

**No 4-up top-of-page KPI/info-card strip** below the page title (see `apps/web/AGENTS.md` UI rule). Use:

- Context-first header
- Section-first metric placement
- Action-oriented summary blocks
- Responsive priority on controls

### Component Patterns

- **Default to Server Components**. Only add `"use client"` when you need state, effects, or browser APIs.
- **Hooks order**: `useState` → `useEffect` → `useMemo` → `useCallback` → custom hooks.
- **Stable callbacks**: handlers passed to memoized children must be wrapped in `useCallback`.
- **No unnecessary `useMemo`**: only memoize expensive computations or referentially-stable values.
- **`useDeferredValue`** for non-urgent derived state from high-frequency streams (SSE, polling). See Performance section.
- **`React.memo`** only when the component is expensive AND the parent can't be optimized.

### State Management

- **URL state** (filters, pagination, sort): use `useSafeQueryStatesFromZod` from `@repo/use-safe-query-param-states-from-zod`. Schema in `_models/`.
- **Local state**: `useState`.
- **Global state**: Zustand stores in `src/state/`.
- **Server state**: React Query via `useQuery` / `useMutation` from ORPC contracts. Never fetch manually.

### Declarative Routing

```typescript
import { Home, ApiAuth } from "@/routes"

// Link
<Home.Link>Home</Home.Link>

// Fetch (in client component)
const data = await ApiAuth.fetch({ input: { ... } })

// Open modal/page
<ApiAuth.Link>Open</ApiAuth.Link>
```

**Never** hardcode `href="/foo"`. **Never** use `fetch("/api/foo")`. The route table in `src/routes/index.ts` is auto-generated.

---

## 🔍 UI/UX Standards

> UX is code. Every interaction is engineered, not accidental. Every state the user can be in (loading, success, error, empty) is a code path that must be designed. Every element has an accessibility story.

### Accessibility (WCAG 2.1 AA Minimum)

- **Keyboard navigation**: every interactive element must be reachable and operable with keyboard alone. No `onClick` on a `<div>` — use `<button>`.
- **Focus indicators**: never `outline: none` without a replacement. Use `focus-visible:` for keyboard-only focus.
- **ARIA labels**: every icon-only button needs `aria-label`. Every form input needs a `<label>` (or `aria-label` / `aria-labelledby`).
- **Color contrast**: text ≥ 4.5:1 against background. Large text (≥18pt or ≥14pt bold) ≥ 3:1.
- **Don't rely on color alone**: a red error without an icon is inaccessible. Add an icon + text.
- **Alt text**: every `<img>` needs `alt` (empty `alt=""` for decorative images).
- **Skip links**: a "Skip to main content" link at the top of every page.
- **Screen reader testing**: use VoiceOver (macOS), NVDA (Windows), or Orca (Linux) to test critical flows at least once.

### Loading States (Three Patterns)

| Pattern | Use when | Example |
|---------|----------|---------|
| **Skeleton** | Loading content that has a known shape (cards, rows, lists) | `<Skeleton className="h-4 w-32" />` |
| **Spinner** | Loading content with unknown duration (button action, save) | `<Loader2 className="animate-spin" />` |
| **Optimistic** | Mutation with very high success rate (toggle, like) | Update UI immediately, roll back on error |

**Every async operation must have a visible loading state.** A button that says "Save" must say "Saving..." or show a spinner while in flight.

### Error States (Three Patterns)

| Pattern | Use when | Example |
|---------|----------|---------|
| **Inline** | Form field validation | `<p className="text-destructive">Email is required</p>` |
| **Toast** | Background action failure (save, fetch) | `toast.error("Failed to save", { description: error.message })` |
| **Page-level** | Page can't render at all | `<ErrorPage error={error} />` with retry button |

**Every error must be informative.** "Something went wrong" is not acceptable. Include:
- What went wrong (human-readable)
- What the user can do (retry, contact support, check their input)
- An error reference ID for support

### Empty States (Three Patterns)

| Pattern | Use when | Example |
|---------|----------|---------|
| **First-time** | User just signed up, no data yet | Big illustration + "Get started" CTA |
| **Filtered** | User filtered, no results | "No containers match these filters" + "Clear filters" button |
| **After delete** | User deleted the last item | "No containers" + "Add a container" button |

**Every list needs an empty state.** A blank screen is not an empty state.

### Form UX

- **Autofocus** the first field on mount (but only if the form is the main content).
- **Native autocomplete** (`autoComplete="email"`, `autoComplete="current-password"`, etc.) — use the right token for the right field.
- **Validation timing**: validate on blur, not on every keystroke. Re-validate on submit. Show success state after a correct value.
- **Submit button state**: disabled while submitting, shows spinner, says "Saving..." or similar.
- **Preserve on error**: don't clear the form on submit failure. The user must not lose their input.
- **Enter submits**: `<form onSubmit>` not `<div onClick>`. Enter key in a field submits the form.
- **Required fields**: mark with `*` and a screen-reader-friendly `aria-required="true"`.

### Responsive Design (Mobile-First)

- **Mobile-first**: write the mobile CSS first, then add breakpoints for larger screens.
- **Breakpoints** (already configured in Tailwind): `sm: 640px`, `md: 768px`, `lg: 1024px`, `xl: 1280px`, `2xl: 1536px`.
- **Touch targets**: minimum 44x44px. Use `min-h-11 min-w-11` on tap targets.
- **Test on real devices**: don't trust Chrome DevTools' device emulation. Test on a phone.
- **No horizontal scroll** on mobile. If a table is too wide, use horizontal scroll INSIDE the table, not on the page.

### Dark Mode / Light Mode

- **Use CSS variables** for all colors (already configured in `packages/ui/base/`).
- **Test both modes** for every UI change. Don't ship a light-mode-only fix.
- **No hardcoded colors**: `bg-white` is wrong. `bg-background` is right.
- **System preference**: respect `prefers-color-scheme` by default. Let users override.

### Microinteractions / Animations

- **Purposeful, not decorative**: every animation should communicate (state change, transition, focus).
- **Fast**: 150-300ms for most transitions. 50ms for micro-interactions. 500ms+ is too slow.
- **Don't animate during loading**: the user is waiting. Animate the result, not the wait.
- **Respect `prefers-reduced-motion`**: users with vestibular disorders can disable animations.
  ```typescript
  // ✅ Respect reduced motion
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ duration: 0.2 }}
    // shadcn/ui handles this automatically via the `tailwindcss-animate` plugin
  />
  ```

### Focus Management

- **After a dialog closes**, return focus to the trigger button.
- **After navigation**, focus the main heading or the first interactive element.
- **Don't trap focus** outside a dialog unintentionally.
- **`tabindex={0}` only when needed** (rare, for custom widgets). Most elements don't need it.

---
