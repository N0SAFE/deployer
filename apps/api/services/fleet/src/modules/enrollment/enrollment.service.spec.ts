import { describe, expect, it, vi } from "vitest";

import { EnrollmentService, type EnrollmentPorts } from "./enrollment.service";

const grant = { managerToken: null, workerToken: "w", controlPlaneAddrs: ["10.0.0.1:2377"], role: "worker" as const, reason: "capacity" };

function ports(over: Partial<EnrollmentPorts> = {}): EnrollmentPorts {
  return {
    version: "3.1.0",
    cluster: vi.fn(async () => ({ clusterId: "c1", cidr: "10.9.0.0/16" })),
    swarmGrant: vi.fn(async () => grant),
    admit: vi.fn(async () => ({ roster: { members: [] } })),
    databaseUrl: () => "postgres://db/deployer",
    register: vi.fn(async (input) => ({ nodeId: input.nodeId, enrolledAt: "2026-10-29T00:00:00.000Z" })),
    ...over,
  };
}

const agentSaying = (valid: boolean) => ({ call: vi.fn(async () => ({ valid })) }) as never;
const enrollInput = { token: "t", nodeId: "node-b", serverUrl: "https://b.example.test" };

describe("EnrollmentService", () => {
  it("describes the fleet to a holder of a valid token, asking its agent first", async () => {
    const agent = agentSaying(true);
    const service = new EnrollmentService(() => agent, ports());

    expect(await service.describe("t")).toEqual({ version: "3.1.0", meshNetwork: { clusterId: "c1", cidr: "10.9.0.0/16" } });
    expect((agent as { call: ReturnType<typeof vi.fn> }).call).toHaveBeenCalledWith(["roster", "check"], { token: "t" }, { context: {} });
  });

  it("enrolls a node: registers it, answers the swarm role the fleet decides and the WireGuard admission", async () => {
    const p = ports();
    const service = new EnrollmentService(() => agentSaying(true), p);

    const result = await service.enroll({ ...enrollInput, requestedSwarmPolicy: "auto", meshJoinRequest: { signed: true } });

    expect(p.register).toHaveBeenCalledWith({ nodeId: "node-b", serverUrl: "https://b.example.test", displayName: null });
    expect(p.swarmGrant).toHaveBeenCalledWith("auto");
    expect(p.admit).toHaveBeenCalledWith({ signed: true });
    expect(result).toMatchObject({ nodeId: "node-b", databaseUrl: "postgres://db/deployer", swarmGrant: grant, meshAdmission: { roster: { members: [] } } });
  });

  it("does not admit anyone to the WireGuard mesh when no join request was sent", async () => {
    const p = ports();
    const result = await new EnrollmentService(() => agentSaying(true), p).enroll(enrollInput);

    expect(p.admit).not.toHaveBeenCalled();
    expect(result.meshAdmission).toBeNull();
  });

  it("refuses a token its agent does not vouch for, and registers nothing", async () => {
    const p = ports();
    const service = new EnrollmentService(() => agentSaying(false), p);

    await expect(service.enroll(enrollInput)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(service.describe("t")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(p.register).not.toHaveBeenCalled();
  });

  it("enrolls no one when it has no agent to vouch for the token", async () => {
    await expect(new EnrollmentService(() => undefined, ports()).enroll(enrollInput)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("refuses to enroll before it has a database to hand over", async () => {
    const p = ports({ databaseUrl: () => null });

    await expect(new EnrollmentService(() => agentSaying(true), p).enroll(enrollInput)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(p.register).not.toHaveBeenCalled();
  });
});
