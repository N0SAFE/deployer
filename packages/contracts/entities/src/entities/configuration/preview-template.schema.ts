import z from "zod/v4";
import { envNameSchema } from "@repo/contracts-common";
import { mockEngineSchema } from "../service/mock-config.schema";

/**
 * PREVIEW SOURCE TEMPLATE — per-service declaration of how a preview of THIS
 * service resolves its backend dependencies.
 *
 * The four modes map directly onto the POC's chained-link model:
 *  - linked-preview:  RECURSE — provision a preview of the dependency too
 *                     (it resolves its own deps by its own policies).
 *  - fixed:           STOP — reuse a shared environment (e.g. staging api).
 *  - mock:            STOP — replace the dependency with a mock implementing
 *                     the same contract (spec-driven OR DI-style code mock).
 *  - derive:          STOP — resolve the environment from a runtime input key
 *                     (e.g. pullRequestNumber), fallback if absent.
 */
export const previewBackendResolutionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("linked-preview") }),
  z.object({ mode: z.literal("fixed"), targetEnvironment: envNameSchema }),
  z.object({
    mode: z.literal("mock"),
    /** Reference to a mock service (by service id or name) implementing the contract. */
    mockRef: z.string().min(1),
    /** Optional engine hint when auto-creating a spec-driven mock. */
    engine: mockEngineSchema.optional(),
  }),
  z.object({
    mode: z.literal("derive"),
    fromInputKey: z.string().min(1),
    fallbackEnvironment: envNameSchema,
  }),
]);
export type PreviewBackendResolution = z.infer<typeof previewBackendResolutionSchema>;

/**
 * A service the preview should spin up alongside this one, with an explicit
 * per-linked-service resolution override (Railway Focused-PR / compose
 * profiles style). Each entry follows the same resolution vocabulary.
 */
export const previewLinkedServiceSchema = z
  .object({
    /** Sub-service id or name to include in this preview. */
    serviceId: z.string().min(1),
    /**
     * How THIS linked service resolves:
     *  - inherit: follow the linked service's own preview template (default).
     *  - mock:    replace it with a mock (mockRef applies).
     *  - fixed:   reuse a shared environment (fixedEnvironment applies).
     */
    mode: z.enum(["inherit", "mock", "fixed"]).default("inherit"),
    mockRef: z.string().min(1).optional(),
    fixedEnvironment: envNameSchema.optional(),
  })
  .strict();
export type PreviewLinkedService = z.infer<typeof previewLinkedServiceSchema>;

export const previewSourceTemplateSchema = z
  .object({
    /** How the preview chooses its backend dependency. */
    backendResolution: previewBackendResolutionSchema.default({ mode: "linked-preview" }),
    /** Services to spin up alongside this preview. */
    linkedServices: z.array(previewLinkedServiceSchema).default([]),
    /** Subdomain template for this preview (GitLab review-app style). */
    subdomainTemplate: z.string().default("{branch}-{service}"),
  })
  .strict();
export type PreviewSourceTemplate = z.infer<typeof previewSourceTemplateSchema>;
