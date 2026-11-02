import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The admin bootstrap is the one place the platform writes a super-admin from
 * environment variables, so the assertions are about the two things it must NOT
 * do: invent credentials, and elevate a user it merely recognised by email.
 *
 * `pg` and the drizzle adapter are mocked because neither a real Postgres nor a
 * real schema is needed to answer "did it write a role?" — the fake records the
 * calls, and the credential decision never reaches the database at all.
 */

const fakeEnd = vi.fn(() => Promise.resolve(undefined));
const fakeLimit = vi.fn();
const fakeWhere = vi.fn(() => ({ limit: fakeLimit }));
const fakeFrom = vi.fn(() => ({ where: fakeWhere }));
const fakeSelect = vi.fn(() => ({ from: fakeFrom }));
const fakeUpdate = vi.fn();

const fakeDb = {
  select: fakeSelect,
  update: fakeUpdate,
};

vi.mock("pg", () => ({
  // A regular function: `new Pool(...)` needs a constructable value, and an
  // arrow function is not one.
  Pool: function FakePool() {
    return { end: fakeEnd };
  },
}));

vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: vi.fn(() => fakeDb),
}));

vi.mock("../../config/auth/auth", () => ({
  // Synchronous: the real factory returns the instance, it does not await it.
  createBetterAuth: vi.fn(() => ({ auth: { $context: Promise.resolve({}) } })),
}));

vi.mock("@deployer/auth/server", () => ({
  provisionUserAccount: vi.fn(() => Promise.resolve("created-user-id")),
}));

const { ensureDefaultAdmin } = await import("./default-admin.bootstrap");
const { provisionUserAccount } = await import("@deployer/auth/server");

describe("ensureDefaultAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DEFAULT_ADMIN_EMAIL;
    delete process.env.DEFAULT_ADMIN_PASSWORD;
    fakeLimit.mockResolvedValue([]);
  });

  it("refuses to create an account when no credentials are configured", async () => {
    // No `admin@admin.com` / `adminadmin` fallback: a forgotten variable used to
    // ship a known super-admin password on every install.
    const result = await ensureDefaultAdmin("postgres://unused/db");

    expect(result.outcome).toBe("failed");
    if (result.outcome !== "failed") throw new Error("expected a refusal");
    expect(result.error).toContain("DEFAULT_ADMIN_EMAIL");
    expect(result.error).toContain("DEFAULT_ADMIN_PASSWORD");

    // Nothing was opened and nothing was written.
    expect(fakeSelect).not.toHaveBeenCalled();
    expect(provisionUserAccount).not.toHaveBeenCalled();
  });

  it("refuses an email with no password instead of inventing one", async () => {
    const result = await ensureDefaultAdmin("postgres://unused/db", {
      email: "operator@example.com",
    });

    expect(result.outcome).toBe("failed");
    expect(provisionUserAccount).not.toHaveBeenCalled();
  });

  it("reports an existing user WITHOUT promoting them", async () => {
    // Matching an email in `DEFAULT_ADMIN_EMAIL` is not a grant. Elevation is an
    // explicit admin action, never a side effect of a boot.
    fakeLimit.mockResolvedValue([{ id: "u1" }]);

    const result = await ensureDefaultAdmin("postgres://unused/db", {
      email: "existing@example.com",
      password: "configured-password",
    });

    expect(result).toEqual({ outcome: "existed", userId: "u1" });
    expect(fakeUpdate).not.toHaveBeenCalled();
    expect(provisionUserAccount).not.toHaveBeenCalled();
  });

  it("creates the admin through the internal adapter with the role, not sign-up", async () => {
    const result = await ensureDefaultAdmin("postgres://unused/db", {
      email: "fresh@example.com",
      password: "configured-password",
    });

    expect(result).toEqual({ outcome: "created", userId: "created-user-id" });
    expect(provisionUserAccount).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ email: "fresh@example.com", role: "superAdmin" }),
    );
    // No follow-up write: the role is set at creation, so the account never
    // exists in an unprivileged state.
    expect(fakeUpdate).not.toHaveBeenCalled();
  });
});
