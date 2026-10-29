import { createHash } from "node:crypto";

import { Logger } from "@nestjs/common";
import { Cause, Effect, Exit } from "effect";

import type {
  DockerImageInspectDetail,
  DockerImageScannerResult,
  DockerImageLayerEfficiency,
  DockerImageSecurityScanEvent,
  DockerImageSecurityScanSummary,
  DockerVulnerabilityEntry,
} from "@deployer/contracts-entities";
import {
  type DockerEngineShape,
  type DockerHostShape,
  type ScannerPoolShape,
  type ScannerType,
} from "@deployer/docker";
import { runPromiseUnwrapped } from "@deployer/effect-core";

import {
  VULNERABILITY_SCAN_TIMEOUT_MS,
  VULNERABILITY_LOG_POLL_INTERVAL_MS,
  VULNERABILITY_LOG_TAIL,
  DEFAULT_IMAGE_SCAN_SCANNER_PARALLELISM,
} from "./docker-image-scanner.types";
import {
  buildScanEvent,
  mergeVulnerabilityEntries,
  parseDiveLayerEfficiency,
  parseGrypeVulnerabilities,
  parseTrivyVulnerabilities,
  splitScannerOutputLines,
} from "./scanner-output";

import type {
  ResolvedImageSecurityScan,
  DockerImageLifecycleRecord,
  DockerImageLifecycleUpsertResult,
  RawImageSecurityScan,
  ScannerRunResult,
  ScannerRunProgressOptions,
  ScannerExecutionResult,
  ScannerExecutionConfig,
  ScannerExecutionProgressOptions,
} from "./docker-image-scanner.types";

/**
 * Where scan results are kept: the persisted scan a fresh one can reuse, and the store a finished one goes to.
 * The scanner knows how to scan; what is cached and for how long is the repository's business.
 */
export type ImageScanStorage = {
  readonly read: (identifiers: string[]) => Promise<RawImageSecurityScan | null>;
  readonly persist: (imageId: string, scan: RawImageSecurityScan) => Promise<void>;
};

/**
 * Runs Trivy, Grype and Dive against an image through the shared scanner containers, with bounded concurrency,
 * progress events and de-duplication of scans already in flight.
 */
export class DockerImageScannerService {
  private readonly logger = new Logger(DockerImageScannerService.name);
  private readonly imageVulnerabilityScansInFlight = new Map<string, Promise<RawImageSecurityScan>>();

  constructor(
    private readonly dockerEngine: DockerEngineShape,
    private readonly scannerPool: ScannerPoolShape,
    private readonly dockerHost: DockerHostShape,
    private readonly storage: ImageScanStorage,
  ) {}

  async resolveImageVulnerabilities(
    inspectId: string,
    scanTargets: string[],
    options: { allowFreshScan?: boolean } = {},
  ): Promise<ResolvedImageSecurityScan> {
    const allowFreshScan = options.allowFreshScan ?? true;

    const persisted = await this.storage.read([inspectId, ...scanTargets]);
    if (persisted) {
      return {
        vulnerabilities: persisted.vulnerabilities,
        scanSummary: {
          ...persisted.scanSummary,
          cached: true,
        },
      };
    }

    if (!allowFreshScan) {
      return {
        vulnerabilities: [],
        scanSummary: null,
      };
    }

    const inFlight = this.imageVulnerabilityScansInFlight.get(inspectId);
    if (inFlight) {
      const inFlightScan = await inFlight;
      return {
        vulnerabilities: inFlightScan.vulnerabilities,
        scanSummary: {
          ...inFlightScan.scanSummary,
          cached: false,
        },
      };
    }

    const scanPromise = this.scanImageVulnerabilities(scanTargets)
      .then(async (scanResult) => {
        await this.storage.persist(inspectId, scanResult);
        return scanResult;
      })
      .catch((error: unknown) => {
        this.logger.warn(`Image vulnerability scan failed for ${inspectId}: ${this.formatError(error)}`);

        const executedAt = new Date().toISOString();
        return {
          vulnerabilities: [],
          scanSummary: {
            scannedAt: executedAt,
            totalFindings: 0,
            scanners: [
              {
                scanner: "trivy",
                status: "failed",
                findingsCount: 0,
                durationMs: null,
                executedAt,
                error: this.formatError(error),
              },
              {
                scanner: "grype",
                status: "failed",
                findingsCount: 0,
                durationMs: null,
                executedAt,
                error: this.formatError(error),
              },
              {
                scanner: "dive",
                status: "failed",
                findingsCount: 0,
                durationMs: null,
                executedAt,
                error: this.formatError(error),
              },
            ],
            layerEfficiency: null,
          },
        } satisfies RawImageSecurityScan;
      })
      .finally(() => {
        this.imageVulnerabilityScansInFlight.delete(inspectId);
      });

    this.imageVulnerabilityScansInFlight.set(inspectId, scanPromise);
    const freshScan = await scanPromise;
    return {
      vulnerabilities: freshScan.vulnerabilities,
      scanSummary: {
        ...freshScan.scanSummary,
        cached: false,
      },
    };
  }

  private async scanImageVulnerabilities(
    scanTargets: string[],
  ): Promise<RawImageSecurityScan> {
    if (scanTargets.length === 0) {
      const executedAt = new Date().toISOString();
      return {
        vulnerabilities: [],
        scanSummary: {
          scannedAt: executedAt,
          totalFindings: 0,
          scanners: [
            {
              scanner: "trivy",
              status: "skipped",
              findingsCount: 0,
              durationMs: 0,
              executedAt,
              error: "No scan targets available",
            },
            {
              scanner: "grype",
              status: "skipped",
              findingsCount: 0,
              durationMs: 0,
              executedAt,
              error: "No scan targets available",
            },
            {
              scanner: "dive",
              status: "skipped",
              findingsCount: 0,
              durationMs: 0,
              executedAt,
              error: "No scan targets available",
            },
          ],
          layerEfficiency: null,
        },
      };
    }

    // Ensure all three shared scanner containers are running before launching tasks
    await Promise.all([
      this.ensureScanner("trivy"),
      this.ensureScanner("grype"),
      this.ensureScanner("dive"),
    ]);

    const [trivyResult, grypeResult, diveResult] = await this.runScannerTasksWithConcurrency(
      [
        () => this.scanUsingTrivy(scanTargets),
        () => this.scanUsingGrype(scanTargets),
        () => this.scanUsingDive(scanTargets),
      ] as const,
      this.resolveScannerParallelism(),
    );

    const mergedVulnerabilities = mergeVulnerabilityEntries([
      ...trivyResult.vulnerabilities,
      ...grypeResult.vulnerabilities,
    ]);

    const scannedAt = new Date().toISOString();

    return {
      vulnerabilities: mergedVulnerabilities,
      scanSummary: {
        scannedAt,
        totalFindings: mergedVulnerabilities.length,
        scanners: [trivyResult.scannerResult, grypeResult.scannerResult, diveResult.scannerResult],
        layerEfficiency: diveResult.layerEfficiency,
      },
    };
  }

  async scanImageVulnerabilitiesWithProgress(
    imageId: string,
    scanTargets: string[],
    options: ScannerRunProgressOptions,
  ): Promise<RawImageSecurityScan> {
    if (scanTargets.length === 0) {
      const executedAt = new Date().toISOString();
      const skippedScanners: DockerImageScannerResult[] = ["trivy", "grype", "dive"].map((scanner) => ({
        scanner,
        status: "skipped",
        findingsCount: 0,
        durationMs: 0,
        executedAt,
        error: "No scan targets available",
      })) as DockerImageScannerResult[];

      const scanSummary: RawImageSecurityScan["scanSummary"] = {
        scannedAt: executedAt,
        totalFindings: 0,
        scanners: skippedScanners,
        layerEfficiency: null,
      };

      options.onEvent?.(buildScanEvent({
        imageId,
        type: "complete",
        stage: "completed",
        scanner: null,
        progress: 100,
        message: "No scan targets available",
        logLine: null,
        scanSummary: {
          ...scanSummary,
          cached: false,
        },
      }));

      return {
        vulnerabilities: [],
        scanSummary,
      };
    }

    options.onEvent?.(buildScanEvent({
      imageId,
      type: "status",
      stage: "scanning",
      scanner: null,
      progress: 10,
      message: "Starting multi-scanner security scan",
      logLine: null,
    }));

    // Ensure all three shared scanner containers are running before launching tasks
    await Promise.all([
      this.ensureScanner("trivy"),
      this.ensureScanner("grype"),
      this.ensureScanner("dive"),
    ]);

    const progressOptions: ScannerRunProgressOptions = {
      ...options,
      imageId,
    };

    const [trivyResult, grypeResult, diveResult] = await this.runScannerTasksWithConcurrency(
      [
        () => this.scanUsingTrivy(scanTargets, progressOptions),
        () => this.scanUsingGrype(scanTargets, progressOptions),
        () => this.scanUsingDive(scanTargets, progressOptions),
      ] as const,
      this.resolveScannerParallelism(),
    );

    options.onEvent?.(buildScanEvent({
      imageId,
      type: "status",
      stage: "merging",
      scanner: null,
      progress: 90,
      message: "Merging scanner findings",
      logLine: null,
    }));

    const mergedVulnerabilities = mergeVulnerabilityEntries([
      ...trivyResult.vulnerabilities,
      ...grypeResult.vulnerabilities,
    ]);

    const scannedAt = new Date().toISOString();
    const scanSummary: RawImageSecurityScan["scanSummary"] = {
      scannedAt,
      totalFindings: mergedVulnerabilities.length,
      scanners: [trivyResult.scannerResult, grypeResult.scannerResult, diveResult.scannerResult],
      layerEfficiency: diveResult.layerEfficiency,
    };

    options.onEvent?.(buildScanEvent({
      imageId,
      type: "complete",
      stage: "completed",
      scanner: null,
      progress: 100,
      message: "Security scan completed",
      logLine: null,
      scanSummary: {
        ...scanSummary,
        cached: false,
      },
      vulnerabilities: mergedVulnerabilities,
    }));

    return {
      vulnerabilities: mergedVulnerabilities,
      scanSummary,
    };
  }

  private async scanUsingTrivy(
    scanTargets: string[],
    options?: ScannerRunProgressOptions,
  ): Promise<ScannerRunResult> {
    const startedAt = Date.now();
    let lastError: string | null = null;
    const imageId = options?.imageId ?? scanTargets[0] ?? "unknown-image";

    for (const target of scanTargets) {
      const command: string[] = [
        "trivy",
        "image",
        "--quiet",
        "--format",
        "json",
        "--severity",
        "CRITICAL,HIGH,MEDIUM,LOW",
        "--timeout",
        "2m",
        target,
      ];

      const fallbackConfig: ScannerExecutionConfig = {
        scanner: "trivy",
        image: "aquasec/trivy:0.69.3",
        command: [
          "image",
          "--quiet",
          "--format",
          "json",
          "--severity",
          "CRITICAL,HIGH,MEDIUM,LOW",
          "--timeout",
          "2m",
          target,
        ],
      };

      options?.onEvent?.(buildScanEvent({
        imageId,
        type: "status",
        stage: "pulling-scanner",
        scanner: "trivy",
        progress: 20,
        message: `Preparing Trivy scanner for target ${target}`,
        logLine: null,
      }));

      try {
        const result = await this.executeScannerViaSharedContainer("trivy", command, fallbackConfig, {
          logPollIntervalMs: options?.logPollIntervalMs,
          onPullLogLine: (line) => {
            options?.onEvent?.(buildScanEvent({
              imageId,
              type: "log",
              stage: "pulling-scanner",
              scanner: "trivy",
              progress: 20,
              message: "Trivy scanner image pull output",
              logLine: line,
            }));
          },
          onLogLine: (line) => {
            options?.onEvent?.(buildScanEvent({
              imageId,
              type: "log",
              stage: "scanning",
              scanner: "trivy",
              progress: 35,
              message: "Trivy output",
              logLine: line,
            }));
          },
        });
        if (result.exitCode !== 0) {
          lastError = `exit_code_${String(result.exitCode)}`;
          this.logger.debug(`Trivy scan returned exit code ${String(result.exitCode)} for ${target}`);
          continue;
        }

        const vulnerabilities = parseTrivyVulnerabilities(result.output);
        const completed: ScannerRunResult = {
          vulnerabilities,
          layerEfficiency: null,
          scannerResult: {
            scanner: "trivy",
            status: "completed",
            findingsCount: vulnerabilities.length,
            durationMs: result.durationMs,
            executedAt: result.executedAt,
            error: null,
          },
        };

        options?.onEvent?.(buildScanEvent({
          imageId,
          type: "result",
          stage: "parsing",
          scanner: "trivy",
          progress: 45,
          message: `Trivy completed with ${String(vulnerabilities.length)} findings`,
          logLine: null,
          scannerResult: completed.scannerResult,
        }));

        return completed;
      } catch (error) {
        lastError = this.formatError(error);
        this.logger.debug(`Trivy scan attempt failed for ${target}: ${this.formatError(error)}`);
      }
    }

    const failedResult: ScannerRunResult = {
      vulnerabilities: [],
      layerEfficiency: null,
      scannerResult: {
        scanner: "trivy",
        status: "failed",
        findingsCount: 0,
        durationMs: Date.now() - startedAt,
        executedAt: new Date().toISOString(),
        error: lastError ?? "No successful scan target",
      },
    };

    options?.onEvent?.(buildScanEvent({
      imageId,
      type: "error",
      stage: "error",
      scanner: "trivy",
      progress: null,
      message: "Trivy scan failed",
      logLine: failedResult.scannerResult.error,
      scannerResult: failedResult.scannerResult,
    }));

    return failedResult;
  }

  private async scanUsingGrype(
    scanTargets: string[],
    options?: ScannerRunProgressOptions,
  ): Promise<ScannerRunResult> {
    const startedAt = Date.now();
    let lastError: string | null = null;
    const imageId = options?.imageId ?? scanTargets[0] ?? "unknown-image";

    for (const target of scanTargets) {
      const command: string[] = [
        "grype",
        `docker:${target}`,
        "--output",
        "json",
        "--quiet",
      ];

      const fallbackConfig: ScannerExecutionConfig = {
        scanner: "grype",
        image: "anchore/grype:latest",
        command: [
          `docker:${target}`,
          "--output",
          "json",
          "--quiet",
        ],
      };

      options?.onEvent?.(buildScanEvent({
        imageId,
        type: "status",
        stage: "pulling-scanner",
        scanner: "grype",
        progress: 50,
        message: `Preparing Grype scanner for target ${target}`,
        logLine: null,
      }));

      try {
        const result = await this.executeScannerViaSharedContainer("grype", command, fallbackConfig, {
          logPollIntervalMs: options?.logPollIntervalMs,
          onPullLogLine: (line) => {
            options?.onEvent?.(buildScanEvent({
              imageId,
              type: "log",
              stage: "pulling-scanner",
              scanner: "grype",
              progress: 50,
              message: "Grype scanner image pull output",
              logLine: line,
            }));
          },
          onLogLine: (line) => {
            options?.onEvent?.(buildScanEvent({
              imageId,
              type: "log",
              stage: "scanning",
              scanner: "grype",
              progress: 60,
              message: "Grype output",
              logLine: line,
            }));
          },
        });
        if (result.exitCode !== 0) {
          lastError = `exit_code_${String(result.exitCode)}`;
          this.logger.debug(`Grype scan returned exit code ${String(result.exitCode)} for ${target}`);
          continue;
        }

        const vulnerabilities = parseGrypeVulnerabilities(result.output);
        const completed: ScannerRunResult = {
          vulnerabilities,
          layerEfficiency: null,
          scannerResult: {
            scanner: "grype",
            status: "completed",
            findingsCount: vulnerabilities.length,
            durationMs: result.durationMs,
            executedAt: result.executedAt,
            error: null,
          },
        };

        options?.onEvent?.(buildScanEvent({
          imageId,
          type: "result",
          stage: "parsing",
          scanner: "grype",
          progress: 70,
          message: `Grype completed with ${String(vulnerabilities.length)} findings`,
          logLine: null,
          scannerResult: completed.scannerResult,
        }));

        return completed;
      } catch (error) {
        lastError = this.formatError(error);
        this.logger.debug(`Grype scan attempt failed for ${target}: ${this.formatError(error)}`);
      }
    }

    const failedResult: ScannerRunResult = {
      vulnerabilities: [],
      layerEfficiency: null,
      scannerResult: {
        scanner: "grype",
        status: "failed",
        findingsCount: 0,
        durationMs: Date.now() - startedAt,
        executedAt: new Date().toISOString(),
        error: lastError ?? "No successful scan target",
      },
    };

    options?.onEvent?.(buildScanEvent({
      imageId,
      type: "error",
      stage: "error",
      scanner: "grype",
      progress: null,
      message: "Grype scan failed",
      logLine: failedResult.scannerResult.error,
      scannerResult: failedResult.scannerResult,
    }));

    return failedResult;
  }

  private async scanUsingDive(
    scanTargets: string[],
    options?: ScannerRunProgressOptions,
  ): Promise<ScannerRunResult> {
    const startedAt = Date.now();
    let lastError: string | null = null;
    const imageId = options?.imageId ?? scanTargets[0] ?? "unknown-image";

    for (const target of scanTargets) {
      const targetCandidates = [target, `docker://${target}`]
        .filter((candidate, index, all) => all.indexOf(candidate) === index);

      for (const candidate of targetCandidates) {
        const command: string[] = [
          "dive",
          "--ci",
          "--lowestEfficiency",
          "0",
          candidate,
        ];

        const fallbackConfig: ScannerExecutionConfig = {
          scanner: "dive",
          image: "wagoodman/dive:latest",
          command: [
            "--ci",
            "--lowestEfficiency",
            "0",
            candidate,
          ],
        };

        options?.onEvent?.(buildScanEvent({
          imageId,
          type: "status",
          stage: "pulling-scanner",
          scanner: "dive",
          progress: 75,
          message: `Preparing Dive scanner for target ${candidate}`,
          logLine: null,
        }));

        try {
          const result = await this.executeScannerViaSharedContainer("dive", command, fallbackConfig, {
            logPollIntervalMs: options?.logPollIntervalMs,
            onPullLogLine: (line) => {
              options?.onEvent?.(buildScanEvent({
                imageId,
                type: "log",
                stage: "pulling-scanner",
                scanner: "dive",
                progress: 75,
                message: "Dive scanner image pull output",
                logLine: line,
              }));
            },
            onLogLine: (line) => {
              options?.onEvent?.(buildScanEvent({
                imageId,
                type: "log",
                stage: "scanning",
                scanner: "dive",
                progress: 82,
                message: "Dive output",
                logLine: line,
              }));
            },
          });
          if (result.exitCode !== 0) {
            lastError = `exit_code_${String(result.exitCode)}`;
            this.logger.debug(`Dive scan returned exit code ${String(result.exitCode)} for ${candidate}`);
            continue;
          }

          const layerEfficiency = parseDiveLayerEfficiency(result.output);
          const completed: ScannerRunResult = {
            vulnerabilities: [],
            layerEfficiency,
            scannerResult: {
              scanner: "dive",
              status: layerEfficiency ? "completed" : "unavailable",
              findingsCount: 0,
              durationMs: result.durationMs,
              executedAt: result.executedAt,
              error: layerEfficiency ? null : "Dive output did not expose layer efficiency metrics",
            },
          };

          options?.onEvent?.(buildScanEvent({
            imageId,
            type: "result",
            stage: "parsing",
            scanner: "dive",
            progress: 88,
            message: layerEfficiency
              ? "Dive completed with layer efficiency insights"
              : "Dive completed without parseable layer efficiency",
            logLine: null,
            scannerResult: completed.scannerResult,
          }));

          return completed;
        } catch (error) {
          lastError = this.formatError(error);
          this.logger.debug(`Dive scan attempt failed for ${candidate}: ${this.formatError(error)}`);
        }
      }
    }

    const failedResult: ScannerRunResult = {
      vulnerabilities: [],
      layerEfficiency: null,
      scannerResult: {
        scanner: "dive",
        status: "failed",
        findingsCount: 0,
        durationMs: Date.now() - startedAt,
        executedAt: new Date().toISOString(),
        error: lastError ?? "No successful scan target",
      },
    };

    options?.onEvent?.(buildScanEvent({
      imageId,
      type: "error",
      stage: "error",
      scanner: "dive",
      progress: null,
      message: "Dive scan failed",
      logLine: failedResult.scannerResult.error,
      scannerResult: failedResult.scannerResult,
    }));

    return failedResult;
  }

  private resolveScannerParallelism(): number {
    const raw = process.env.APP_DOCKER_IMAGE_SCAN_PARALLELISM;
    if (typeof raw !== "string") {
      return DEFAULT_IMAGE_SCAN_SCANNER_PARALLELISM;
    }

    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
      return DEFAULT_IMAGE_SCAN_SCANNER_PARALLELISM;
    }

    return Math.min(3, Math.max(1, parsed));
  }

  private async runScannerTasksWithConcurrency<TTasks extends readonly (() => Promise<unknown>)[]>(
    tasks: TTasks,
    concurrency: number,
  ): Promise<{ [K in keyof TTasks]: Awaited<ReturnType<TTasks[K]>> }> {
    if (tasks.length === 0) {
      return [] as { [K in keyof TTasks]: Awaited<ReturnType<TTasks[K]>> };
    }

    const normalizedConcurrency = Math.max(1, Math.min(tasks.length, concurrency));
    const results = new Array<unknown>(tasks.length);
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (cursor < tasks.length) {
        const currentIndex = cursor;
        cursor += 1;

        const task = tasks[currentIndex];
        if (!task) {
          continue;
        }

        results[currentIndex] = await task();
      }
    };

    await Promise.all(
      Array.from({ length: normalizedConcurrency }).map(() => worker()),
    );

    return results as { [K in keyof TTasks]: Awaited<ReturnType<TTasks[K]>> };
  }

  private async scannerImageExistsLocally(image: string): Promise<boolean> {
    return await runPromiseUnwrapped(this.dockerEngine.images.exists(image));
  }

  /**
   * Execute a scanner command inside the shared scanner container.
   * Falls back to a per-scanner ephemeral container if the shared
   * container is unavailable (e.g. image not built yet, disabled).
   */
  private async executeScannerViaSharedContainer(
    scanner: "trivy" | "grype" | "dive",
    command: string[],
    fallbackConfig: ScannerExecutionConfig,
    progressOptions: ScannerExecutionProgressOptions = {},
  ): Promise<ScannerExecutionResult> {
    const startedAt = Date.now();
    const scannerType = scanner;

    // Try shared container first
    const ready = await this.ensureScanner(scannerType);
    if (ready) {
      try {
        const result = await runPromiseUnwrapped(this.scannerPool.exec(scannerType, command));
        return {
          scanner,
          exitCode: result.exitCode,
          output: result.output,
          durationMs: result.durationMs,
          executedAt: new Date().toISOString(),
        };
      } catch (error) {
        this.logger.debug(
          `Shared container exec failed for ${scanner}, falling back to ephemeral container: ${this.formatError(error)}`,
        );
      }
    }

    // Fallback: use the old per-scanner ephemeral container
    this.logger.debug(`Using ephemeral container fallback for ${scanner}`);
    return this.executeScannerContainer(fallbackConfig, progressOptions);
  }

  private async executeScannerContainer(
    config: ScannerExecutionConfig,
    progressOptions: ScannerExecutionProgressOptions = {},
  ): Promise<ScannerExecutionResult> {
    const startedAt = Date.now();
    const randomSuffix = createHash("sha1")
      .update(`${config.scanner}:${Date.now().toString()}:${Math.random().toString()}`)
      .digest("hex")
      .slice(0, 8);
    const containerName = `deployer-${config.scanner}-scan-${randomSuffix}`;

    const scannerImageExists = await this.scannerImageExistsLocally(config.image);
    if (!scannerImageExists) {
      try {
        await runPromiseUnwrapped(
          this.dockerEngine.images.pull(config.image, {
            retries: 3,
            backoffMs: 2_000,
            onProgressLine: (line) => {
              const normalized = line.trim();
              if (normalized.length > 0) {
                progressOptions.onPullLogLine?.(normalized);
              }
            },
          }),
        );
      } catch (error) {
        this.logger.debug(`Unable to pre-pull scanner image ${config.image}: ${this.formatError(error)}`);
      }
    }

    const socketBind = this.dockerHost.socketBind;
    const envVars: string[] = [];

    if (socketBind) {
      const hostPath = socketBind.split(":")[0];
      envVars.push(`DOCKER_HOST=unix://${String(hostPath)}`);
    }

    const created = await runPromiseUnwrapped(this.dockerEngine.containers.create({
      Image: config.image,
      name: containerName,
      Cmd: config.command,
      Env: envVars.length > 0 ? envVars : undefined,
      HostConfig: {
        AutoRemove: false,
        Binds: socketBind ? [socketBind] : undefined,
      },
      Tty: false,
    }));

    const scannerContainerId = created.id;

    try {
      await runPromiseUnwrapped(this.dockerEngine.containers.start(scannerContainerId));

      const normalizedLogPollIntervalMs = Math.max(
        200,
        progressOptions.logPollIntervalMs ?? VULNERABILITY_LOG_POLL_INTERVAL_MS,
      );
      const emittedLines = new Set<string>();
      let latestOutput = "";

      const emitNewLines = (output: string) => {
        latestOutput = output;
        if (!progressOptions.onLogLine) {
          return;
        }

        const lines = splitScannerOutputLines(output);
        for (const line of lines) {
          const normalized = line.trim();
          if (normalized.length === 0) {
            continue;
          }

          const key = `${config.scanner}|${normalized}`;
          if (emittedLines.has(key)) {
            continue;
          }

          emittedLines.add(key);
          progressOptions.onLogLine(normalized);
        }
      };

      const fetchLatestLogs = async () => {
        const output = await runPromiseUnwrapped(
          this.dockerEngine.logs.read(scannerContainerId, {
            stdout: true,
            stderr: true,
            tail: VULNERABILITY_LOG_TAIL,
          }),
        );
        emitNewLines(output);
      };

      const logPoller = setInterval(() => {
        void fetchLatestLogs().catch(() => {
          // Ignore transient polling errors while the scanner is still running.
        });
      }, normalizedLogPollIntervalMs);

      void fetchLatestLogs().catch(() => {
        // Ignore first-pass fetch errors and rely on subsequent polling.
      });

      let waitResult = 1;
      try {
        waitResult = await this.waitForContainerExit(scannerContainerId, VULNERABILITY_SCAN_TIMEOUT_MS);
      } finally {
        clearInterval(logPoller);
      }

      await fetchLatestLogs().catch(() => {
        // Keep latest known output if the terminal fetch fails.
      });

      return {
        scanner: config.scanner,
        exitCode: waitResult,
        output: latestOutput,
        durationMs: Date.now() - startedAt,
        executedAt: new Date().toISOString(),
      };
    } finally {
      await this.cleanupScannerContainer(scannerContainerId, config.scanner);
    }
  }

  private async cleanupScannerContainer(
    containerId: string,
    scanner: ScannerExecutionConfig["scanner"],
  ): Promise<void> {
    const containers = this.dockerEngine.containers;
    const attempts = 3;

    /** Whether the container is gone; an engine failure other than "not found" is reported, not thrown. */
    const probe = containers.inspect(containerId).pipe(
      Effect.as<"present" | "gone">("present"),
      Effect.catchTag("DockerNotFound", () => Effect.succeed<"present" | "gone">("gone")),
    );
    const pause = (attempt: number) => Effect.promise(() => this.delay(200 * attempt));
    const note = (message: string) => Effect.sync(() => { this.logger.debug(message); });

    // Cleanup never fails the caller: a container that cannot be removed is logged and re-checked.
    const removeContainer = containers.remove(containerId).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          this.logger.error(`Failed to remove container ${containerId}: ${this.formatError(error)}`);
        }),
      ),
    );
    const describe = (cause: Cause.Cause<unknown>) => this.formatError(Cause.squash(cause));

    const cleanup = Effect.gen(function* () {
      for (let attempt = 1; attempt <= attempts; attempt++) {
        yield* removeContainer;

        const afterRemove = yield* Effect.exit(probe);
        if (Exit.isFailure(afterRemove)) {
          yield* note(
            `Scanner container ${containerId} inspect check failed after cleanup attempt ${String(attempt)}: ${describe(afterRemove.cause)}`,
          );
          if (attempt < attempts) yield* pause(attempt);
          continue;
        }
        if (afterRemove.value === "gone") return true;

        const forced = yield* Effect.exit(containers.removeIfExists(containerId, { removeVolumes: true }));
        if (Exit.isFailure(forced)) {
          yield* note(
            `Scanner container ${containerId} force-remove attempt ${String(attempt)} failed: ${describe(forced.cause)}`,
          );
        }

        const afterForce = yield* Effect.exit(probe);
        if (Exit.isSuccess(afterForce) && afterForce.value === "gone") return true;

        if (attempt < attempts) yield* pause(attempt);
      }
      return false;
    });

    if (!(await runPromiseUnwrapped(cleanup))) {
      this.logger.warn(
        `Scanner container ${containerId} for ${scanner} still exists after cleanup retries`,
      );
    }
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private async waitForContainerExit(containerId: string, timeoutMs: number): Promise<number> {
    // Timing out interrupts the wait, which aborts the request in flight.
    return await runPromiseUnwrapped(
      this.dockerEngine.containers.wait(containerId).pipe(
        Effect.timeoutOrElse({
          duration: timeoutMs,
          orElse: () => Effect.fail(new Error(`Timed out waiting for scanner container ${containerId}`)),
        }),
      ),
    );
  }

  private ensureScanner(scanner: ScannerType): Promise<boolean> {
    return runPromiseUnwrapped(this.scannerPool.ensureRunning(scanner));
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }
}
