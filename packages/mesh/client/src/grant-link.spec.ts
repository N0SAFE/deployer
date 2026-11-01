import { ORPCError, type ClientContext, type ClientLink } from "@orpc/client";
import { describe, expect, it, vi } from "vitest";

import { grantDirect, redirectTo } from "@deployer/node-agent-contracts";

import { grantFollowingLink } from "./grant-link";

type Link = ClientLink<ClientContext>;

const grant = (overrides: Partial<Parameters<typeof grantDirect>[0]> = {}) =>
  grantDirect({ replicaId: "runtime-2", address: "ws://10.0.0.2:3105", token: "t1", expiresAt: 10_000, ...overrides });

const call = (link: Link) => link.call(["logs", "stream"], { id: 1 }, { context: {} });

describe("grantFollowingLink", () => {
  it("returns the agent's answer when it brokered the call", async () => {
    const agent: Link = { call: vi.fn().mockResolvedValue("brokered") };
    const direct = vi.fn();

    await expect(call(grantFollowingLink({ agent, direct }))).resolves.toBe("brokered");
    expect(direct).not.toHaveBeenCalled();
  });

  it("follows a grant and replays the same call on the replica", async () => {
    const agent: Link = { call: vi.fn().mockRejectedValue(grant()) };
    const replica = { call: vi.fn().mockResolvedValue("from replica") };
    const direct = vi.fn(() => replica as Link);

    const result = await call(grantFollowingLink({ agent, direct, now: () => 1_000 }));

    expect(result).toBe("from replica");
    expect(direct).toHaveBeenCalledWith(expect.objectContaining({ replicaId: "runtime-2", token: "t1" }));
    expect(replica.call).toHaveBeenCalledWith(["logs", "stream"], { id: 1 }, { context: {} });
  });

  it("reuses the replica's link while its grant is valid, and builds a new one after it expires", async () => {
    const agent: Link = { call: vi.fn().mockRejectedValue(grant({ expiresAt: 5_000 })) };
    const direct = vi.fn(() => ({ call: vi.fn().mockResolvedValue("ok") }));
    let now = 1_000;
    const link = grantFollowingLink({ agent, direct, now: () => now });

    await call(link);
    await call(link);
    expect(direct).toHaveBeenCalledTimes(1);

    now = 5_000;
    await call(link);
    expect(direct).toHaveBeenCalledTimes(2);
  });

  it("drops a refused grant and asks the agent again", async () => {
    const agent: Link = {
      call: vi.fn().mockRejectedValueOnce(grant({ token: "stale" })).mockRejectedValueOnce(grant({ token: "fresh" })),
    };
    const refused = { call: vi.fn().mockRejectedValue(new ORPCError("UNAUTHORIZED", { message: "lease expired" })) };
    const accepted = { call: vi.fn().mockResolvedValue("ok") };
    const direct = vi.fn().mockReturnValueOnce(refused).mockReturnValueOnce(accepted);

    const result = await call(grantFollowingLink({ agent, direct: direct as never, now: () => 1_000 }));

    expect(result).toBe("ok");
    expect(agent.call).toHaveBeenCalledTimes(2);
    expect(direct).toHaveBeenCalledTimes(2);
  });

  it("asks the agent again when the direct link itself died", async () => {
    const agent: Link = { call: vi.fn().mockRejectedValueOnce(grant()).mockResolvedValueOnce("brokered") };
    const direct = vi.fn(() => ({ call: vi.fn().mockRejectedValue(new Error("socket closed")) }));

    await expect(call(grantFollowingLink({ agent, direct, now: () => 1_000 }))).resolves.toBe("brokered");
  });

  it("returns a real error from the replica instead of retrying it", async () => {
    const agent: Link = { call: vi.fn().mockRejectedValue(grant()) };
    const direct = vi.fn(() => ({ call: vi.fn().mockRejectedValue(new ORPCError("NOT_FOUND", { message: "no such stream" })) }));

    await expect(call(grantFollowingLink({ agent, direct, now: () => 1_000 }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(agent.call).toHaveBeenCalledTimes(1);
  });

  it("stops following when the agent keeps granting and the replica keeps refusing", async () => {
    const agent: Link = { call: vi.fn().mockRejectedValue(grant()) };
    const direct = vi.fn(() => ({ call: vi.fn().mockRejectedValue(new ORPCError("UNAUTHORIZED", { message: "no" })) }));

    await expect(call(grantFollowingLink({ agent, direct, maxFollows: 2, now: () => 1_000 }))).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(agent.call).toHaveBeenCalledTimes(2);
  });

  it("does not treat any other error from the agent as a grant", async () => {
    const agent: Link = { call: vi.fn().mockRejectedValue(redirectTo("project-3", "holds it")) };

    await expect(call(grantFollowingLink({ agent, direct: vi.fn() }))).rejects.toMatchObject({ code: "MESH_REDIRECT" });
  });
});
