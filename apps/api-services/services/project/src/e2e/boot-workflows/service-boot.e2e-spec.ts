import { beforeAll, describe, expect, it } from "vitest";
import { getSharedApiRuntimeContext, type SharedApiRuntimeContext } from "@/e2e/runtime";

/**
 * The project service boots, and says so.
 *
 * Booting the real root module is the check that matters here: a provider that cannot be
 * resolved fails the whole Nest container ("Nest can't resolve dependencies of …") before the
 * first request, so reaching `/health` proves the dependency graph resolves with the real
 * wiring. It replaces the monolith's `debug-compile-full`, which compiled the monolith's
 * module with a mocked environment and said nothing about this app.
 */
describe("project service boot e2e", () => {
  let context: SharedApiRuntimeContext;

  beforeAll(async () => {
    context = await getSharedApiRuntimeContext();
  });

  it("serves its liveness probe once the module graph has resolved", async () => {
    const response = await context.http.get("/health").expect(200);

    expect((response.body as { status: string }).status).toBe("ok");
  });

  it("does not serve a protected route to an anonymous caller", async () => {
    await context.http.get("/projects").expect(401);
  });
});
