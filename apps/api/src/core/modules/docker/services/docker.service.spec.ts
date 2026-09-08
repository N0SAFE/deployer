import { describe, expect, it, vi } from "vitest";
import { DockerService } from "./docker.service";
import { EnvService } from "@/config/env/env.service";

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
  inspectSequence?: Array<() => unknown>;
  createResolve?: () => Promise<unknown> | unknown;
  createReject?: (err: unknown) => Promise<never>;
}) {
  const envService = {
    get: (key: string) => (key === "DOCKER_HOST" ? "tcp://docker.example.invalid:2375" : undefined),
  } as unknown as EnvService;

  const service = new DockerService(envService);

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
