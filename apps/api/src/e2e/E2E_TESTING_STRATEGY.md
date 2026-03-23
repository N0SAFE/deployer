# E2E Testing Strategy (API)

## Philosophy: oRPC-First

The primary API boundaries in v3 are governed by **oRPC contracts**. To ensure the tightest possible coupling between contract definitions and runtime behavior, our E2E tests are driven **first and foremost by the shared oRPC client**, rather than relying solely on generic HTTP asserting tools like `supertest`.

**Why oRPC over Supertest?**
- **Type Safety**: The request input and response payloads map cleanly to your Zod schemas. Changes to contracts instantly break out-of-date tests at compilation time.
- **Refactoring**: Renaming routes or path parameters in an oRPC contract does not silently break tests that had hardcoded URL strings.
- **Domain Focus**: Supertest often requires repetitive assertions (like parsing JSON bodies, asserting `status: 200`), whereas an oRPC client inherently asserts that payload shapes are valid before they even return to the test.

## Transport Metadata Interception (HTTP Assertions)

A classic challenge when adopting RPC clients in E2E tests is validating actual HTTP transport properties:
- *"Did the server return a 201 instead of a 200?"*
- *"Were the expected Headers (like cookies, CORS, content-type) properly set in the response?"*

To solve this, our test harness integrates a custom `fetch` proxy underneath standard `OpenAPILink`. You can access low-level transport metadata across any oRPC call using `orpcTracker` directly from the runtime context.

### Example

```typescript
import { beforeAll, describe, expect, it } from "vitest";
import { getSharedApiRuntimeContext } from "@/e2e/utils/shared-api-runtime";

describe("Users API", () => {
    let context: Awaited<ReturnType<typeof getSharedApiRuntimeContext>>;

    beforeAll(async () => {
        context = await getSharedApiRuntimeContext();
    });

    it("fetches a user and validates HTTP constraints", async () => {
        // 1. Fire strongly typed request
        const result = await context.orpc.user.get({ id: "usr_123" });
        
        // 2. Validate typed domain return
        expect(result.id).toBe("usr_123");

        // 3. Inspect raw HTTP transport metadata using the tracker
        const meta = context.orpcTracker.getLast();
        expect(meta?.status).toBe(200); // Verify exact HTTP status
        expect(meta?.headers["content-type"]).toContain("application/json");
        expect(meta?.headers["set-cookie"]).toBeDefined(); // Verify things that oRPC strips
    });
});
```

## The Single `SharedApiRuntimeContext`

All E2E tests boot exactly ONE shared instance of the NestJS application to reduce memory waste and startup time. Booting the context gives you immediate, type-safe access to the following dependencies:

```typescript
const context = await getSharedApiRuntimeContext();

context.runtime        // Provides Postgres instance, TestModule bindings, active HTTP ports
context.orpc           // Unified oRPC root client bound to `appContract`
context.http           // Supertest instance for fallback testing (e.g. raw webhooks, invalid JSON payloads)
context.betterAuth     // Direct programmatic reference to the BetterAuth server (skips mocking sessions)
context.serviceMapper  // Proxy to the runtime DI container: `context.serviceMapper.get(DeployService)`
context.orpcTracker    // Last transport metadata received by the internal oRPC fetch adapter
```

## Use Cases for Supertest (`context.http`)

Do not completely ban `supertest`. Use it when:
1. **Testing Malformed JSON/Bytes:** Validating how the web framework parses intentionally broken HTTP payloads that oRPC schemas refuse to send.
2. **Third-Party Webhooks:** Testing endpoints bound to GitHub/Payment gateway payloads (non-oRPC HTTP routes).
3. **Invalid Auth Formatting:** Sending deliberately mutilated Bearer tokens or missing authorization schemes that BetterAuth/Nest intercepts.

## Test Boundaries & Coverage

For any newly ported v3 module, E2E tests should map workflows rather than just single endpoints:

1. **Authentication:** 
    - Verified under `/auth-workflows` (login, registration boundaries, RBAC role guard rejection).
2. **Setup Workflow:** 
    - Verified under `/setup-workflows` (platform initialization states).
3. **Deployment Orchestration:** 
    - E2E tests for complex pipelines mapping source repository pulls, queue queuing, and container lifecycle integration.

*Note: Unit tests handle internal component correctness (`*.spec.ts`). E2E validates entire module lifecycles using the `SharedRuntimeServiceMapper` for environment injection.*
