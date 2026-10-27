import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createSharedSetupOrpcClient,
  getSharedApiRuntimeContext,
  stopSharedApiRuntime,
  type SharedApiRuntimeContext,
} from "@/e2e/runtime";

type Instance = { instanceKey: string; context: SharedApiRuntimeContext };

/**
 * Two BFF instances in one test process.
 *
 * This is a test of the HARNESS, and the foundation a real multi-node mesh e2e is built on:
 * each `instanceKey` must give a runtime of its own (own port, own response tracker, own
 * database), because a mesh test that shares any of them cannot tell a node's behaviour from
 * its neighbour's. It used to be called a "containerized multi-node mesh" test and ran three
 * instances; it never exercised mesh, only that the instances do not collide, which two
 * instances prove as well as three at a third of the boot cost.
 */
describe("multi-instance shared runtime e2e", () => {
  const instances: Instance[] = [];

  beforeAll(async () => {
    for (const instanceKey of ["mesh-node-a", "mesh-node-b"]) {
      instances.push({ instanceKey, context: await getSharedApiRuntimeContext({ instanceKey }) });
    }
  }, 180_000);

  afterAll(async () => {
    await Promise.all(instances.map(({ instanceKey }) => stopSharedApiRuntime({ instanceKey })));
  });

  const instance = (index: number): Instance => {
    const found = instances[index];
    if (!found) throw new Error(`expected a shared runtime at index ${String(index)}`);
    return found;
  };

  it("starts isolated runtimes on distinct ports, each answering for itself", async () => {
    const baseUrls = instances.map(({ context }) => context.runtime.baseUrl);

    expect(new Set(baseUrls).size).toBe(2);
    expect(new Set(baseUrls.map((url) => new URL(url).port)).size).toBe(2);

    for (const baseUrl of baseUrls) {
      const response = await fetch(new URL("/setup/state", baseUrl));
      expect(response.status).toBe(200);
      expect(typeof ((await response.json()) as { needsSetup: boolean }).needsSetup).toBe("boolean");
    }
  }, 120_000);

  it("keeps each instance's response tracker to its own calls", async () => {
    const first = instance(0);
    const second = instance(1);
    first.context.orpcTracker.clear();
    second.context.orpcTracker.clear();

    const firstClient = await createSharedSetupOrpcClient(
      { tracker: first.context.orpcTracker },
      { instanceKey: first.instanceKey },
    );
    const secondClient = await createSharedSetupOrpcClient(
      { tracker: second.context.orpcTracker },
      { instanceKey: second.instanceKey },
    );
    const [firstState, secondState] = await Promise.all([firstClient.getState(), secondClient.getState()]);

    expect(typeof firstState.needsSetup).toBe("boolean");
    expect(typeof secondState.needsSetup).toBe("boolean");
    // `requestUrl` is path-only, so isolation is proven by each tracker seeing exactly its own call.
    expect(first.context.orpcTracker).not.toBe(second.context.orpcTracker);
    expect(first.context.orpcTracker.getAll()).toHaveLength(1);
    expect(second.context.orpcTracker.getAll()).toHaveLength(1);
    expect(first.context.orpcTracker.getLast()).toMatchObject({ status: 200 });
    expect(first.context.orpcTracker.getLast()?.requestUrl).toContain("/setup/state");
  }, 120_000);

  it("answers the same on the plain HTTP path and the oRPC path of one instance", async () => {
    const { context } = instance(0);

    const [httpResponse, orpcState] = await Promise.all([
      fetch(new URL("/setup/state", context.runtime.baseUrl)),
      context.orpc.setup.getState(),
    ]);

    expect(httpResponse.status).toBe(200);
    expect(orpcState.needsSetup).toBe(((await httpResponse.json()) as { needsSetup: boolean }).needsSetup);
  }, 120_000);
});
