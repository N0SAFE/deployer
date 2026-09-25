/**
 * Guards `generateSpec()` against contract shapes the OpenAPI generator rejects.
 *
 * The generator throws — it does not skip — when a single operation is
 * malformed, and because it runs inside the orchestrator's `/openapi.json`
 * handler, one bad contract turns that endpoint into a 500 and takes
 * `/reference` (Scalar) down with it. That is exactly what happened with
 * `docker.runtime.snapshot`: a GET whose input schema resolved to
 * `ZodUndefined`, which fails the generator's "GET input must be
 * object | any | unknown" rule.
 *
 * This test exists so the next malformed contract fails here, in CI, instead of
 * silently breaking the published spec at runtime.
 */
import { describe, expect, it } from "vitest";
import { generateSpec } from "@/openapi";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

type SpecPaths = Record<string, Record<string, unknown>>;

/**
 * `spec.paths` is optional in the OpenAPI types; every assertion here needs it
 * present. Narrowing once keeps the checks readable and avoids re-asserting.
 */
async function specPaths(): Promise<SpecPaths> {
    const spec = await generateSpec();
    const paths = spec.paths;
    expect(paths, "generated spec must declare paths").toBeDefined();
    return paths as SpecPaths;
}

describe("generateSpec", () => {
    it("generates a spec from the full app contract", async () => {
        const spec = await generateSpec();

        expect(spec.openapi).toBeDefined();
        expect(spec.paths).toBeDefined();
        expect(Object.keys(spec.paths ?? {}).length).toBeGreaterThan(0);
    });

    it("emits no path item without an HTTP method", async () => {
        const paths = await specPaths();

        for (const [path, item] of Object.entries(paths)) {
            const methods = Object.keys(item ?? {}).filter((k) =>
                (HTTP_METHODS as readonly string[]).includes(k),
            );
            expect(methods.length, `path ${path} declares no HTTP method`).toBeGreaterThan(0);
        }
    });

    it("keeps the docker runtime snapshot reachable", async () => {
        const paths = await specPaths();

        // Regression guard for the `ZodUndefined` input that broke generation:
        // the generator aborted on this exact procedure.
        const snapshotPath = Object.keys(paths).find((p) => p.includes("snapshot"));
        expect(snapshotPath, "docker.runtime.snapshot must appear in the spec").toBeDefined();
    });

    it("gives every operation a resolvable response object", async () => {
        const paths = await specPaths();

        for (const [path, item] of Object.entries(paths)) {
            for (const method of HTTP_METHODS) {
                const op = item[method];
                if (!op || typeof op !== "object") continue;

                const responses = (op as { responses?: Record<string, unknown> }).responses;
                expect(
                    responses && Object.keys(responses).length > 0,
                    `${method.toUpperCase()} ${path} declares no responses`,
                ).toBe(true);
            }
        }
    });
});
