import * as z from "zod/v4";
import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";

/**
 * DRY-RUN preview topology resolution — the read-model that shows how a
 * preview of a service would resolve its linked dependencies WITHOUT actually
 * deploying anything (lifecycle comes in a later phase).
 *
 * The resolver walks the dependency graph recursively and applies each hop's
 * policy:
 *  - the CONSUMER's `preview.backendResolution` decides how it resolves its
 *    backend (linked-preview / fixed / mock / derive),
 *  - a mock hop is validated against the project contract registry +
 *    `implementsContract` (DI swap must match contractRef),
 *  - linked-preview recurses into the dependency's own subtree.
 *
 * Real example (test project):
 *   web-prod (root, linked-preview)
 *     └─ api-prod (linked-preview)
 *          ├─ api-db-prod (linked-preview — fresh per-PR Postgres)
 *          └─ api-cache-prod (fixed → staging — shared cache)
 */
export const previewResolutionKindSchema = z.enum([
    "root",
    "linked-preview",
    "fixed",
    "mock",
    "derive",
]);
export type PreviewResolutionKind = z.infer<typeof previewResolutionKindSchema>;

/**
 * One resolved hop in the preview topology chain (FLAT list — the UI builds
 * the tree from `depth`/`path`). No recursion needed.
 */
export const resolvedPreviewNodeSchema = z
    .object({
        serviceId: z.uuid(),
        serviceName: z.string(),
        /** How THIS hop resolved. `root` = the requested service. */
        resolution: previewResolutionKindSchema,
        /** Fixed/derive hops: the target environment (e.g. staging). */
        targetEnvironment: z.string().optional(),
        /** Mock hops: the mock service ref (id or name). */
        mockRef: z.string().optional(),
        /** Mock hops: whether the swap passed the contract validation. */
        mockValidated: z.boolean().optional(),
        /** Human-readable reason for the hop (why it resolved this way). */
        reason: z.string().optional(),
        /** The contract this hop's mock must satisfy. */
        contractRef: z.string().optional(),
        /** Tree position: depth (0 = root) and slash path (e.g. "root/api"). */
        depth: z.number().int().nonnegative().default(0),
        path: z.string().min(1).default("root"),
    })
    .strict();

export type ResolvedPreviewNode = z.infer<typeof resolvedPreviewNodeSchema>;

export const previewTopologyResolveOutputSchema = z.object({
    /** The requested service's resolved chain (flat list, root first). */
    nodes: z.array(resolvedPreviewNodeSchema),
    /** Environment the resolution ran for. */
    environment: z.string(),
    /** Preview context that shaped the resolution. */
    input: z.object({
        pullRequestNumber: z.number().int().positive().optional(),
        branch: z.string().optional(),
    }),
    /** Contracts consulted during validation. */
    contracts: z.array(z.string()).default([]),
});

const previewTopologyOps = standard.zod(previewTopologyResolveOutputSchema, "previewTopologyResolve");

/**
 * POST /services/:id/preview-topology
 * Dry-run: resolve what a preview of this service WOULD look like (which
 * linked services spin up, which are reused from staging, which are mocks).
 * Does NOT deploy anything.
 */
export const previewTopologyResolveContract = previewTopologyOps
    .create()
    .summary("Dry-run preview topology resolution (linked services)")
    .path("/preview-topology")
    .input((b) =>
        b
            .params((p) => p`/${p("serviceId", z.uuid())}`)
            .body(
                z.object({
                    environment: z.enum(["production", "staging", "preview", "development"]).default("preview"),
                    pullRequestNumber: z.number().int().positive().optional(),
                    branch: z.string().optional(),
                }),
            ),
    )
    .output(previewTopologyResolveOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();
