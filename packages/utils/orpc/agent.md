# ORPC Builder Agent Guide (`@repo/orpc-utils`)

This guide explains the **intended usage** of the ORPC builder API in this package, especially when extending `standard.zod(...)` operations.

## Core principle

Start from a full standard operation, then extend it with builder callbacks.

- ✅ Preferred: `standard.zod(entitySchema, "entity").create().input(...).output(...).build()`
- ❌ Avoid: defining ad-hoc routes first when a standard operation already exists

The standard operation is the base contract; builder callbacks refine params/query/body/headers/status.

---

## Input behavior (critical)

### 1) Direct schema input = body-like/simple input

Both of these set a direct input schema (simple mode):

- `.input(schema)`
- `.input((b) => schema)`

If you need request structure (`params`, `query`, `body`, `headers`), use the detailed builder chain.

### 2) Detailed input chain

Use:

- `.body(...)`
- `.params(...)`
- `.query(...)`
- `.headers(...)`

Example pattern:

```ts
.input((b) =>
  b
    .body((s) => s.omit({ id: true }).extend({ displayName: z.string() }))
    .params((p) => p`/orgs/${p("orgId", z.uuid())}/users`)
    .query(z.object({ includeInactive: z.coerce.boolean().optional() }))
    .headers({ "x-request-id": z.string().optional() })
)
```

### 3) Template params automatically set route path

When using template params:

```ts
.params((p) => p`/orgs/${p("orgId", z.uuid())}/users`)
```

the builder stores a pending path and RouteBuilder applies it. Prefer this for path+param consistency.

### 3.1) Path customization rule (important)

- For **static paths** (no dynamic segment), direct path methods are fine:
  - `.path("/users")`
  - `.path("/orgs/users/search")`

- For any path with **dynamic params**, use `input.params(...)` **always**:
  - ✅ `.input((b) => b.params((p) => p`/orgs/${p("orgId", z.uuid())}/users`))`
  - ❌ Avoid raw dynamic path strings like `.path("/orgs/:orgId/users")` or `.path("/orgs/{orgId}/users")` without typed params wiring.

Reason: `input.params(...)` keeps route path and param schema synchronized, with strong typing and safer refactors.

### 4) Input schema transformations

Available input-side helpers include:

- `.pick([...])`
- `.omit([...])`
- `.partial()`
- `.extend({...})`
- `.custom(...)`

Body-level callback transforms are also supported:

```ts
.input((b) => b.body((s) => s.pick({ name: true, email: true })))
```

### 5) Streaming and observable input body

- `.input((b) => b.body.streamed(chunkSchema))`
- `.input((b) => b.body.observable(eventSchema))`

---

## Output behavior

Use output builder chain for response structure:

- `.body(...)`
- `.status(code)`
- `.headers(...)`
- `.streamed(...)`
- `.observable(...)`
- `.union([...])`

Example pattern:

```ts
.output((b) =>
  b
    .body(responseSchema)
    .status(200)
    .headers({ "x-total-count": z.string().optional() })
)
```

For status variants:

```ts
.output((b) =>
  b.union([
    b.status(200).body(successSchema),
    b.status(404).body(notFoundSchema),
    b.status(409).body(conflictSchema),
  ])
)
```

---

## Union guidance

### Output unions

Output unions are first-class via `.output((b) => b.union([...]))`.

### Input unions

Input unions now mirror output style via `.input((b) => b.union([...]))`.

Use whichever variant style is most readable:

- raw schemas:

```ts
.input((b) => b.union([
  z.object({ mode: z.literal("email"), email: z.email() }),
  z.object({ mode: z.literal("id"), id: z.uuid() }),
]))
```

- builder variants (including detailed params/query/body/headers when needed):

```ts
.input((b) => b.union([
  b
    .params((p) => p`/orgs/${p("orgId", z.uuid())}/users`)
    .body(z.object({ mode: z.literal("email"), email: z.email() })),
  b
    .params((p) => p`/orgs/${p("orgId", z.uuid())}/users`)
    .body(z.object({ mode: z.literal("id"), id: z.uuid() })),
]))
```

Direct schema unions (`.input(z.union([...]))`) remain valid too.

---

## Recommended standard-op workflow

Use this sequence for new contracts:

1. Create operation base: `const ops = standard.zod(entitySchema, "entity")`
2. Pick operation: `ops.read() | ops.create() | ops.update() | ops.delete() | ops.list(...)`
3. Extend input with detailed builder chain if needed (`body/params/query/headers`)
4. Extend output with status/headers/union as needed
5. Build: `.build()`

Canonical template:

```ts
const userOps = standard.zod(userSchema, "user");

export const orgUserCreateContract = userOps
  .create()
  .input((b) =>
    b
      .body((s) => s.omit({ id: true, createdAt: true, updatedAt: true }))
      .params((p) => p`/orgs/${p("orgId", z.uuid())}/users`)
      .headers({ "x-request-id": z.string().optional() })
  )
  .output((b) =>
    b.union([
      b.status(201).body(userSchema),
      b.status(409).body(z.object({ message: z.string() })),
    ])
  )
  .build();
```

---

## Common mistakes to avoid

1. **Expecting structured input from `.input((b) => schema)`**  
   That sets a direct schema only. Use `b.body().params().query().headers()` for detailed shape.

2. **Putting response concerns on input**  
   `status(...)` is output-side. Keep response modeling in `.output(...)`.

3. **Replacing instead of extending**  
   Keep the standard operation as baseline and refine it through builder callbacks.

4. **Path/params drift**  
  For static paths, direct `.path(...)` is fine. For dynamic segments, always use `input.params(...)` template params (`p => p\`...\``) so path and param schemas stay in sync.

---

## Short rule of thumb

- If you only need a plain body schema: `.input(schema)` is fine.
- If you need real HTTP request modeling: always use `.input((b) => b.body(...).params(...).query(...).headers(...))`.
- Use direct `.path(...)` only for static endpoints; if path contains dynamic params, always define path via `input.params(...)`.
- For response variants: use `.output((b) => b.union([...]))`.
- Keep contracts anchored to `standard.zod(...).<operation>()` and extend from there.
