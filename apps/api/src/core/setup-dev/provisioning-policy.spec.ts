import { describe, it, expect } from "vitest";
import {
  resolveProvisioningPolicy,
  resolveAdminBootstrapDecision,
  describePolicy,
  type ProvisioningEnv,
} from "./provisioning-policy";
import type { ManagedGlobalDbEnv } from "@repo/env";

const managedDb: ManagedGlobalDbEnv = {
  enabled: true,
  url: undefined,
  host: "global-db",
  port: 5432,
  user: "deployer",
  password: "deployer",
  name: "deployer",
  image: "postgres:16-alpine",
};

describe("resolveProvisioningPolicy", () => {
  it("compose_managed + SETUP_AUTO → providedUrl + admin always + fatal probe", () => {
    const policy = resolveProvisioningPolicy({
      nodeEnv: "development",
      setupAuto: "true",
      managed: managedDb,
    } satisfies ProvisioningEnv);
    expect(policy.mode).toBe("compose_managed");
    expect(policy.providedUrl).toMatch(/^postgresql:\/\/deployer:deployer@global-db:5432\/deployer$/);
    expect(policy.admin).toBe("always");
    expect(policy.fatalIfUnreachable).toBe(true);
    expect(policy.expectsWizard).toBe(true); // provided DB ≠ done → setup still runs
  });

  it("explicit_url → providedUrl + admin always + fatal probe", () => {
    const policy = resolveProvisioningPolicy({
      nodeEnv: "development",
      setupAuto: "true",
      explicitDatabaseUrl: "postgresql://u:p@db:5432/a",
    } satisfies ProvisioningEnv);
    expect(policy.mode).toBe("explicit_url");
    expect(policy.providedUrl).toBe("postgresql://u:p@db:5432/a");
    expect(policy.fatalIfUnreachable).toBe(true);
    expect(policy.admin).toBe("always");
  });

  it("managed (SETUP_AUTO, no URL) → admin when_empty, non-fatal probe", () => {
    const policy = resolveProvisioningPolicy({
      nodeEnv: "development",
      setupAuto: "true",
    } satisfies ProvisioningEnv);
    expect(policy.mode).toBe("managed");
    expect(policy.providedUrl).toBeNull();
    expect(policy.admin).toBe("when_empty");
    expect(policy.fatalIfUnreachable).toBe(false);
    expect(policy.dbSource).toBe("docker_container");
  });

  it("manual (no SETUP_AUTO) → admin when_empty, human wizard", () => {
    const policy = resolveProvisioningPolicy({
      nodeEnv: "development",
      setupAuto: "false",
    } satisfies ProvisioningEnv);
    expect(policy.mode).toBe("manual");
    expect(policy.admin).toBe("when_empty");
    expect(policy.expectsWizard).toBe(true);
  });

  it("compose_managed without SETUP_AUTO → non-fatal (manual wizard can fix)", () => {
    const policy = resolveProvisioningPolicy({
      nodeEnv: "development",
      setupAuto: "false",
      managed: managedDb,
    } satisfies ProvisioningEnv);
    expect(policy.mode).toBe("compose_managed");
    expect(policy.fatalIfUnreachable).toBe(false);
    expect(policy.admin).toBe("always");
  });
});

describe("resolveAdminBootstrapDecision", () => {
  it("ADMIN_BOOTSTRAP=true wins over alias and defaults", () => {
    const { decision } = resolveAdminBootstrapDecision({
      nodeEnv: "development",
      adminBootstrap: "true",
      enableDevBootstrap: "false",
    });
    expect(decision).toBe("always");
  });

  it("ADMIN_BOOTSTRAP=false wins over alias and defaults", () => {
    const { decision } = resolveAdminBootstrapDecision({
      nodeEnv: "development",
      adminBootstrap: "false",
      enableDevBootstrap: "true",
    });
    expect(decision).toBe("never");
  });

  it("honours deprecated ENABLE_DEV_BOOTSTRAP when ADMIN_BOOTSTRAP unset (dev)", () => {
    const res = resolveAdminBootstrapDecision({
      nodeEnv: "development",
      enableDevBootstrap: "true",
    });
    expect(res.decision).toBe("always");
    expect(res.aliasUsed).toBe("ENABLE_DEV_BOOTSTRAP");
  });

  it("mode default for compose_managed is always", () => {
    const { decision } = resolveAdminBootstrapDecision(
      { nodeEnv: "development" },
      "compose_managed",
    );
    expect(decision).toBe("always");
  });
});

describe("describePolicy", () => {
  it("renders a one-line human-readable summary", () => {
    const policy = resolveProvisioningPolicy({
      nodeEnv: "development",
      setupAuto: "true",
      managed: managedDb,
    });
    expect(describePolicy(policy)).toContain("mode=compose_managed");
    expect(describePolicy(policy)).toContain("admin=always");
  });
});
