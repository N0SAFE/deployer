import { describe, expect, it, vi } from "vitest";
import { DockerRepository } from "./docker.repository";

type ScannerKind = "trivy" | "grype" | "dive";

function createCleanupHarness(params: {
  inspectImpl: () => Promise<unknown>;
  removeImpl?: () => Promise<unknown>;
}) {
  const inspect = vi.fn(params.inspectImpl);
  const remove = vi.fn(params.removeImpl ?? (async () => undefined));

  const removeContainer = vi.fn(async () => undefined);
  const getContainer = vi.fn(() => ({ inspect, remove }));
  const getDockerClient = vi.fn(() => ({ getContainer }));

  const dockerService = {
    removeContainer,
    getDockerClient,
  };

  const scannerContainerManager = {
    ensureContainerRunning: vi.fn(async () => true),
    execInScanner: vi.fn(async () => ({ exitCode: 0, output: "", durationMs: 0 })),
    stopContainer: vi.fn(async () => undefined),
    cleanStaleScannerImages: vi.fn(async () => undefined),
    onModuleDestroy: vi.fn(async () => undefined),
  };

  const repository = new DockerRepository(
    dockerService as never,
    scannerContainerManager as never,
    {} as never,
  );

  const delaySpy = vi.fn(async () => undefined);
  (repository as unknown as { delay: (ms: number) => Promise<void> }).delay = delaySpy;

  const cleanupScannerContainer = (
    repository as unknown as {
      cleanupScannerContainer: (containerId: string, scanner: ScannerKind) => Promise<void>;
    }
  ).cleanupScannerContainer.bind(repository);

  return {
    cleanupScannerContainer,
    inspect,
    remove,
    removeContainer,
    delaySpy,
  };
}

describe("DockerRepository scanner container cleanup", () => {
  it("returns when container is already gone after standard remove", async () => {
    const harness = createCleanupHarness({
      inspectImpl: async () => {
        throw {
          statusCode: 404,
          message: "No such container",
        };
      },
    });

    await harness.cleanupScannerContainer("scanner-ctr-1", "trivy");

    expect(harness.removeContainer).toHaveBeenCalledTimes(1);
    expect(harness.remove).not.toHaveBeenCalled();
    expect(harness.delaySpy).not.toHaveBeenCalled();
  });

  it("force-removes when inspect shows container still exists", async () => {
    const harness = createCleanupHarness({
      inspectImpl: vi
        .fn<() => Promise<unknown>>()
        .mockResolvedValueOnce({ State: { Status: "exited" } })
        .mockRejectedValueOnce({ statusCode: 404, message: "No such container" }),
    });

    await harness.cleanupScannerContainer("scanner-ctr-2", "grype");

    expect(harness.removeContainer).toHaveBeenCalledTimes(1);
    expect(harness.remove).toHaveBeenCalledTimes(1);
    expect(harness.inspect).toHaveBeenCalledTimes(2);
    expect(harness.delaySpy).not.toHaveBeenCalled();
  });

  it("retries cleanup up to three attempts when container keeps reappearing", async () => {
    const harness = createCleanupHarness({
      inspectImpl: async () => ({ State: { Status: "running" } }),
    });

    await harness.cleanupScannerContainer("scanner-ctr-3", "dive");

    expect(harness.removeContainer).toHaveBeenCalledTimes(3);
    expect(harness.remove).toHaveBeenCalledTimes(3);
    expect(harness.delaySpy).toHaveBeenCalledTimes(2);
  });
});