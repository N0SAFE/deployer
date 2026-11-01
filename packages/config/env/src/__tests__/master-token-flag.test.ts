import { describe, expect, it } from "vitest";
import { apiEnvSchema } from "@deployer/env/index";

/**
 * `ENABLE_MASTER_TOKEN` gates a dev-only auth bypass, so its parser decides
 * whether a bypass can be switched on by a typo.
 *
 * It used to be `zod.coerce.boolean()`, where EVERY non-empty string is true —
 * so `ENABLE_MASTER_TOKEN=false` enabled the master token. `booleanEnv()` is the
 * shared strict parser (and idempotent, which the double-validating EnvService
 * requires).
 */
const parse = (value: unknown) => apiEnvSchema.shape.ENABLE_MASTER_TOKEN.safeParse(value);

describe("ENABLE_MASTER_TOKEN", () => {
  it('parses "false" as false', () => {
    const result = parse("false");

    expect(result.success).toBe(true);
    expect(result.data).toBe(false);
  });

  it('parses "true" as true', () => {
    expect(parse("true").data).toBe(true);
  });

  it("stays undefined when unset (absence is the default)", () => {
    const result = parse(undefined);

    expect(result.success).toBe(true);
    expect(result.data).toBeUndefined();
  });

  it("rejects anything that is not a boolean token", () => {
    expect(parse("maybe").success).toBe(false);
  });
});
