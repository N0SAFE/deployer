import z from "zod/v4";

/**
 * The setup app's OWN environment contract.
 *
 * Deliberately separate from the API's (`apiEnvSchema`). The setup app runs
 * before the platform exists and needs a different, much smaller set of
 * variables — no database URL, no auth secret, no supervisor toggles. Sharing
 * one schema between the two apps would mean each one validating (and
 * requiring defaults for) variables it never uses.
 *
 * This file is the reason `@repo/nest-env` takes a schema instead of shipping
 * one: the mechanism is shared, the contract is not.
 */
export const setupEnvSchema = z.object({
  /** Port the setup app listens on. Internal only — Traefik fronts it. */
  SETUP_APP_PORT: z.coerce.number().int().positive().default(3016),

  /**
   * `dev` waits for the API (compose manages it); `prod` creates the API as a
   * swarm service from `DEPLOYER_API_IMAGE`.
   */
  SETUP_MODE: z.enum(["dev", "prod"]).default("dev"),

  /** Where the full API answers, in dev. Unused in prod (setup creates it). */
  SETUP_API_URL: z.string().optional(),

  /** The image tag setup schedules on the swarm in prod mode. */
  DEPLOYER_API_IMAGE: z.string().optional(),

  /** How many API replicas to schedule. */
  DEPLOYER_API_REPLICAS: z.coerce.number().int().positive().default(1),

  /** Tenant prefix for hostname and network naming. */
  DEPLOYER_PREFIX: z.string().default(""),

  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type SetupEnv = z.infer<typeof setupEnvSchema>;
