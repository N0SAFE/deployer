import * as z from "zod";
import { standardDomainErrorContracts } from "@repo/orpc-utils";
import { serviceOps, serviceObjectSchema } from "./shared";
import {
  serviceProviderConfigUnionSchema,
  serviceRunnerConfigUnionSchema,
} from "@repo/contracts-entities";

/**
 * Recursive create input: a service may carry its own children (sub-services),
 * which are materialized as REAL service rows linked via parentId. Children
 * may themselves have children — full nesting. Uses zod v4's native recursive
 * `get` accessor (no `z.lazy()`).
 */
const serviceCreateInputBaseSchema = serviceObjectSchema
  .omit({ id: true, isActive: true, createdAt: true, updatedAt: true })
  .partial({
    description: true,
    providerConfig: true,
    builderConfig: true,
    port: true,
    environmentVariables: true,
    resourceLimits: true,
    deploymentRetention: true,
    healthCheckPath: true,
    healthCheckInterval: true,
    healthCheckTimeout: true,
    healthCheckRetries: true,
    traefikConfig: true,
    customDomains: true,
    metadata: true,
    implementsContract: true,
    preview: true,
    network: true, // inherit project's DNS-provider network config by default
  })
  .extend({
    // Hierarchy: attach under an existing parent, and/or define children.
    parentId: z.uuid().nullable().optional(),
    parentPath: z.string().nullable().optional(),
    depth: z.number().int().nonnegative().optional(),
  });

type ServiceCreateInputBase = z.infer<typeof serviceCreateInputBaseSchema>;
type ServiceCreateInputBaseInput = z.input<typeof serviceCreateInputBaseSchema>;

/**
 * Input for creating a service, including nested sub-services.
 *
 * Declared as recursive interfaces (instead of a plain `z.infer` of the
 * schema) because TypeScript's declaration emitter cannot name an anonymous
 * recursive type: it replaces the self-reference with `any` (emitted as
 * `ZodObject<elided, ...>`), which collapses `children` to
 * `Record<string, unknown>[]` for every consumer that type-checks against the
 * emitted declarations. Annotating the schema with those interfaces keeps the
 * recursion exact — see the zod "recursive types" guidance.
 */
export interface ServiceCreateInput extends ServiceCreateInputBase {
  children?: ServiceCreateInput[];
}

/** Input shape of {@link ServiceCreateInput} (pre-validation, before defaults). */
export interface ServiceCreateInputInput extends ServiceCreateInputBaseInput {
  children?: ServiceCreateInputInput[];
}

export const serviceCreateInputSchema: z.ZodType<
  ServiceCreateInput,
  ServiceCreateInputInput
> = serviceCreateInputBaseSchema.extend({
  get children() {
    return z.array(serviceCreateInputSchema).optional();
  },
});

// Output schema: serviceObjectShape (strips superRefine) with nullable configs.
// On creation, providerConfig/builderConfig are null — the superRefine on
// serviceSchema would reject those, so we use a plain object without it.
const serviceCreateOutputSchema = serviceObjectSchema.extend({
  providerConfig: serviceProviderConfigUnionSchema.nullable(),
  builderConfig: serviceRunnerConfigUnionSchema.nullable(),
});

export const serviceCreateContract = serviceOps
  .create()
  .input(serviceCreateInputSchema)
  .output((b) => b.body(serviceCreateOutputSchema))
  .errors((e) => [
    // Project not found, provider/runner validation, name collisions,
    // sub-service recursion depth limits → typed client catch path.
    ...standardDomainErrorContracts(e),
  ])
  .build();
