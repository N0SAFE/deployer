import { describe, expect, it, vi } from "vitest";
import type { DockerConnectionConfig } from "../docker-config";
import { DockerService } from "./docker.service";

/**
 * Focused unit tests for DockerService.ensureOverlayNetwork's layering guard:
 * a Deployer-OWNED workload network must ALWAYS be an overlay. If a network
 * with the target name already exists but is NOT an overlay (e.g. a
 * compose-created BRIDGE that shares a name), the guard must FAIL LOUDLY
 * instead of silently reusing it — otherwise the later swarm service creation
 * errors with Docker's HTTP 403 (bridge networks can't be attached to swarm
 * services), the exact bug this guards against.
 *
 * We bypass DockerService's normal socket bootstrap by giving DOCKER_HOST a
 * non-local TCP URL, then stub the private `this.docker` dockerode client via
 * a cast to inject the fake network operations deterministically.
 */

function makeService(dockerStub: {
  inspectResolve?: () => Promise<{ Driver?: string }> | { Driver?: string };
  inspectReject?: (err: unknown) => Promise<never>;
  inspectSequence?: (() => unknown)[];
  createResolve?: () => Promise<unknown> | unknown;
  createReject?: (err: unknown) => Promise<never>;
}) {
  const config: DockerConnectionConfig = {
    host: "tcp://docker.example.invalid:2375",
    port: undefined,
  };

  const service = new DockerService(config);

  let seq = 0;
  const network = {
    inspect: vi.fn().mockImplementation(async () => {
      if (dockerStub.inspectSequence) {
        const fn = dockerStub.inspectSequence[seq++] ?? dockerStub.inspectSequence[dockerStub.inspectSequence.length - 1]!;
        return fn();
      }
      if (dockerStub.inspectReject) {
        return dockerStub.inspectReject(new Error("not found"));
      }
      return dockerStub.inspectResolve?.() ?? {};
    }),
  };

  (service as unknown as { docker: { getNetwork: () => typeof network } }).docker = {
    getNetwork: () => network,
    createNetwork: vi.fn().mockImplementation(async () => {
      if (dockerStub.createReject) {
        return dockerStub.createReject(new Error("create failed"));
      }
      return dockerStub.createResolve?.() ?? {};
    }),
  } as never;

  return { service, network, createNetwork: (service as unknown as { docker: { createNetwork: ReturnType<typeof vi.fn> } }).docker.createNetwork };
}

describe("DockerService.ensureOverlayNetwork (layering guard)", () => {
  const overlayRequest = {
    name: "deployer-project-1",
    driver: "overlay",
    attachable: true,
    ingress: false,
    enableIpv6: false,
    labels: { "deployer.managed": "true" },
  };

  it("reuses an existing OVERLAY network (idempotent)", async () => {
    const { service, network } = makeService({ inspectResolve: () => ({ Driver: "overlay" }) });
    await service.ensureOverlayNetwork(overlayRequest);
    expect(network.inspect).toHaveBeenCalledTimes(1);
  });

  it("refuses to reuse an existing BRIDGE (non-overlay) network — the compose-ownership conflict", async () => {
    const { service } = makeService({ inspectResolve: () => ({ Driver: "bridge" }) });
    await expect(service.ensureOverlayNetwork(overlayRequest)).rejects.toThrow(
      /refusing to use a non-overlay network/,
    );
  });

  it("creates an overlay when the network does not exist", async () => {
    const { service, createNetwork } = makeService({
      inspectReject: async () => {
        throw Object.assign(new Error("network not found"), { statusCode: 404 });
      },
      createResolve: () => ({}),
    });
    await service.ensureOverlayNetwork(overlayRequest);
    expect(createNetwork).toHaveBeenCalledTimes(1);
  });

  it("fails when a concurrently-created network is BRIDGE, not overlay", async () => {
    const { service, createNetwork } = makeService({
      // 1st inspect → 404 (network absent), then after a create race the
      // fallback re-inspects → finds a BRIDGE network → must reject.
      inspectSequence: [
        () => {
          throw Object.assign(new Error("network not found"), { statusCode: 404 });
        },
        () => ({ Driver: "bridge" }),
      ],
      createReject: async () => {
        throw new Error("create failed (already exists)");
      },
    });
    await expect(service.ensureOverlayNetwork(overlayRequest)).rejects.toThrow(
      /refusing to use a non-overlay network/,
    );
    expect(createNetwork).toHaveBeenCalledTimes(1);
  });
});

describe("DockerService.recreateOverlayNetwork (poisoned VXLAN repair)", () => {
  const VNI = "com.docker.network.driver.overlay.vxlanid_list";
  const request = {
    name: "deployer-platform-overlay",
    driver: "overlay",
    attachable: true,
    ingress: false,
    enableIpv6: false,
    labels: {},
  };

  function build(opts: { removeFailures?: number } = {}) {
    const service = new DockerService({ host: "tcp://docker.example.invalid:2375", port: undefined });
    const calls: string[] = [];
    let removeFailures = opts.removeFailures ?? 0;
    let exists = true;
    const network = {
      inspect: vi.fn(async () => {
        if (!exists) throw Object.assign(new Error("not found"), { statusCode: 404 });
        return { Id: "net-id", Driver: "overlay", Options: { [VNI]: "4097" } };
      }),
      disconnect: vi.fn(async () => {
        calls.push("disconnect");
      }),
      remove: vi.fn(async () => {
        if (removeFailures-- > 0) throw new Error("network is in use by service x");
        calls.push("remove");
        exists = false;
      }),
    };
    const createNetwork = vi.fn(async () => {
      calls.push("create");
      exists = true;
    });
    (service as unknown as { docker: unknown }).docker = {
      getNetwork: () => network,
      createNetwork,
      listNetworks: vi.fn(async () => [{ Options: { [VNI]: "4096" } }, { Options: { [VNI]: "4099" } }]),
    };
    const svc = service as unknown as {
      listSwarmServices: unknown;
      removeSwarmService: unknown;
    };
    svc.listSwarmServices = vi.fn(async () => [
      { Spec: { Name: "svc-bff", TaskTemplate: { Networks: [{ Target: "net-id" }] } } },
      { Spec: { Name: "unrelated", TaskTemplate: { Networks: [{ Target: "other" }] } } },
    ]);
    svc.removeSwarmService = vi.fn(async (name: string) => {
      calls.push(`rm:${name}`);
    });
    return { service, createNetwork, calls };
  }

  it("removes attached services, drops the network and recreates it on an unused, different VNI", async () => {
    const { service, createNetwork, calls } = build();
    const result = await service.recreateOverlayNetwork(request, { detachContainerIds: ["me"] });

    expect(result.removedServices).toEqual(["svc-bff"]);
    expect(calls).toEqual(["rm:svc-bff", "disconnect", "remove", "create"]);
    // 4097 is poisoned, 4096 and 4099 are taken by other networks → 4098.
    expect(result.vxlanId).toBe(4098);
    expect(createNetwork).toHaveBeenCalledWith(
      expect.objectContaining({ Options: { [VNI]: "4098" } }),
    );
  });

  it("never reuses a VNI the caller already saw poisoned", async () => {
    const { service } = build();
    const result = await service.recreateOverlayNetwork(request, { avoidVxlanIds: [4098] });
    expect(result.vxlanId).toBe(4100);
    expect(result.avoidedVxlanIds).toEqual(expect.arrayContaining([4097, 4098]));
  });
});
