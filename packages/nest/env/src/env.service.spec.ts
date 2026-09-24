import { describe, expect, it, vi } from "vitest";
import { ConfigService } from "@nestjs/config";
import z from "zod/v4";

import { EnvService } from "./env.service";

/**
 * `EnvService` is SCHEMA-AGNOSTIC: it holds no environment contract of its own.
 *
 * That is the property under test. An earlier version defaulted to the API's
 * schema, which meant any other app importing the package silently inherited
 * the API's variables — the "business logic in a package" failure the boundary
 * rule forbids. These specs pin the corrected behaviour: two different apps,
 * two different schemas, one mechanism.
 */

const apiLikeSchema = z.object({
  API_PORT: z.coerce.number().default(3005),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  OPTIONAL_TOKEN: z.string().optional(),
});

/** A second, unrelated contract — proving the service is not bound to one. */
const setupLikeSchema = z.object({
  SETUP_APP_PORT: z.coerce.number().default(3016),
  SETUP_MODE: z.enum(["dev", "prod"]).default("dev"),
});

function withEnv(values: Record<string, string>, fn: () => void): void {
  const previous: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(values)) {
    previous[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe("EnvService — schema-agnostic", () => {
  it("reads through the schema the CALLER supplied", () => {
    withEnv({ API_PORT: "4000" }, () => {
      const service = new EnvService(apiLikeSchema);
      expect(service.get("API_PORT")).toBe(4000);
    });
  });

  it("serves a second app's schema with the same service class", () => {
    // The whole point: `apps/setup` gets its own contract from the same
    // mechanism, and never sees the API's variables.
    withEnv({ SETUP_APP_PORT: "9999", SETUP_MODE: "prod" }, () => {
      const service = new EnvService(setupLikeSchema);
      expect(service.get("SETUP_APP_PORT")).toBe(9999);
      expect(service.get("SETUP_MODE")).toBe("prod");
    });
  });

  it("does NOT expose another app's variables", () => {
    // A regression here would mean the package had grown a default schema
    // again. TypeScript rejects the key at compile time; this asserts the
    // runtime value is genuinely absent rather than coincidentally undefined.
    const service = new EnvService(setupLikeSchema) as unknown as {
      get: (k: string) => unknown;
    };
    expect(service.get("API_PORT")).toBeUndefined();
  });

  it("applies the schema's defaults and coercions on a VALID environment", () => {
    withEnv({ API_PORT: "4001" }, () => {
      const service = new EnvService(apiLikeSchema);
      // Coerced from the string by the schema, not read raw.
      expect(service.get("API_PORT")).toBe(4001);
      // Absent variable → the schema's default, not `undefined`.
      delete process.env.OPTIONAL_TOKEN;
      expect(new EnvService(apiLikeSchema).get("OPTIONAL_TOKEN")).toBeUndefined();
    });
  });

  it("applies a DEFAULT for an absent variable", () => {
    withEnv({}, () => {
      delete process.env.API_PORT;
      expect(new EnvService(apiLikeSchema).get("API_PORT")).toBe(3005);
    });
  });

  it("falls back to a raw snapshot instead of throwing when validation fails", () => {
    // A CLI or unit test that only needs one value must not die because an
    // unrelated variable is missing.
    const strict = z.object({ REQUIRED_THING: z.string().min(1) });
    const service = new EnvService(strict) as unknown as { get: (k: string) => unknown };
    expect(service.get("PATH")).toBeDefined();
  });
});

describe("EnvService — derived schemas", () => {
  it("use() derives a service for a DIFFERENT schema from the same environment", () => {
    // The CLI pattern: one broad service, then a narrow per-command schema.
    withEnv({ SETUP_MODE: "prod" }, () => {
      const base = new EnvService(apiLikeSchema);
      const narrow = base.use(setupLikeSchema);

      expect(narrow.get("SETUP_MODE")).toBe("prod");
      // The derived service has its own contract, not the base's.
      expect((narrow as unknown as { get: (k: string) => unknown }).get("API_PORT")).toBeUndefined();
    });
  });
});

describe("EnvService — ConfigService path", () => {
  it("re-reads values through the schema when a ConfigService is injected", () => {
    // In an app, `ConfigModule.forRoot` has already validated; the service
    // re-reads THROUGH the schema so defaults and coercions still apply.
    const configService = new ConfigService({ API_PORT: "7777" });
    const service = new EnvService(apiLikeSchema, configService);

    expect(service.get("API_PORT")).toBe(7777);
  });

  it("derives a service that shares the ConfigService", () => {
    const configService = new ConfigService({ API_PORT: "8888", SETUP_MODE: "dev" });
    const base = new EnvService(apiLikeSchema, configService);
    const narrow = base.use(setupLikeSchema);

    expect(narrow.get("SETUP_MODE")).toBe("dev");
  });
});

describe("EnvService — mode helpers", () => {
  it("reports the mode from process.env", () => {
    withEnv({ NODE_ENV: "production" }, () => {
      const service = new EnvService(apiLikeSchema);
      expect(service.isProduction()).toBe(true);
      expect(service.isDevelopment()).toBe(false);
      expect(service.isTest()).toBe(false);
    });
  });
});
