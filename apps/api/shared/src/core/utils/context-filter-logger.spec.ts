import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextFilterLogger } from "@repo/logger";

const FILTER_ENV = "TEST_CONTEXT_DEBUG_FILTER";
const FALLBACK_ENV = "TEST_CONTEXT_DEBUG_ENABLED";

describe("ContextFilterLogger", () => {
  beforeEach(() => {
    delete process.env[FILTER_ENV];
    delete process.env[FALLBACK_ENV];
  });

  afterEach(() => {
    delete process.env[FILTER_ENV];
    delete process.env[FALLBACK_ENV];
    vi.restoreAllMocks();
  });

  it("does not emit when no filter and fallback disabled", () => {
    const debugSpy = vi.fn<(message: string, context?: Record<string, unknown>) => void>();

    const logger = new ContextFilterLogger({
      defaultClassName: "DockerRuntimeStreamOrchestratorService",
      filterEnvVar: FILTER_ENV,
      fallbackEnableEnvVar: FALLBACK_ENV,
      sink: { debug: debugSpy },
    });

    logger.debug("stream", { phase: "subscription_open" });

    expect(debugSpy).not.toHaveBeenCalled();
  });

  it("emits when fallback env is enabled and no filter exists", () => {
    process.env[FALLBACK_ENV] = "true";
    const debugSpy = vi.fn<(message: string, context?: Record<string, unknown>) => void>();

    const logger = new ContextFilterLogger({
      defaultClassName: "DockerRuntimeStreamOrchestratorService",
      filterEnvVar: FILTER_ENV,
      fallbackEnableEnvVar: FALLBACK_ENV,
      sink: { debug: debugSpy },
    });

    logger.debug("stream", { phase: "subscription_open" });

    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy.mock.calls[0]?.[0]).toContain("DockerRuntimeStreamOrchestratorService.stream");
  });

  it("matches full target glob patterns", () => {
    process.env[FILTER_ENV] = "DockerRuntimeStreamOrchestratorService.stream";
    const debugSpy = vi.fn<(message: string, context?: Record<string, unknown>) => void>();

    const logger = new ContextFilterLogger({
      defaultClassName: "DockerRuntimeStreamOrchestratorService",
      filterEnvVar: FILTER_ENV,
      sink: { debug: debugSpy },
    });

    logger.debug("stream", { phase: "subscription_open" });
    logger.debug("traceIncomingEvent", { phase: "source_event_relay" });

    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy.mock.calls[0]?.[0]).toContain("DockerRuntimeStreamOrchestratorService.stream");
  });

  it("supports class/method filters and partial text matching", () => {
    process.env[FILTER_ENV] = "class:*Relay* method:observe";
    const debugSpy = vi.fn<(message: string, context?: Record<string, unknown>) => void>();

    const logger = new ContextFilterLogger({
      defaultClassName: "DockerRuntimeMeshRelayService",
      filterEnvVar: FILTER_ENV,
      sink: { debug: debugSpy },
    });

    logger.debug({ methodName: "observeRuntimeEvents" }, { phase: "observer_subscribe" });

    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy.mock.calls[0]?.[0]).toContain("DockerRuntimeMeshRelayService.observeRuntimeEvents");
  });

  it("extracts method names from function sources", () => {
    process.env[FILTER_ENV] = "*collectMetricEvents*";
    const debugSpy = vi.fn<(message: string, context?: Record<string, unknown>) => void>();

    const logger = new ContextFilterLogger({
      defaultClassName: "DockerContainerMetricsStreamService",
      filterEnvVar: FILTER_ENV,
      sink: { debug: debugSpy },
    });

    function collectMetricEvents() {
      return undefined;
    }

    logger.debug(collectMetricEvents, { phase: "collect_metrics" });

    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy.mock.calls[0]?.[0]).toContain("DockerContainerMetricsStreamService.collectMetricEvents");
  });
});
