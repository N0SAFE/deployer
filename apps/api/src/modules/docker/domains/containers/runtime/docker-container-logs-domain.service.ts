import { Injectable } from "@nestjs/common";
import { Observable, catchError, from, interval, startWith, switchMap, throwError } from "rxjs";
import type {
  DockerContainerLogsStreamQueryInput,
  DockerContainerProcessLogsStreamQueryInput,
  DockerContainerProcessesQueryInput,
  DockerContainerProcessesStreamQueryInput,
} from "@repo/api-contracts/modules/docker/containers/shared";
import type { DockerContainerLogEntry, DockerContainerProcessEntry } from "@repo/contracts-entities";
import { DockerContainerRuntimeMeshService } from "../mesh/docker-container-runtime-mesh.service";
import { DockerContainerRuntimeService } from "../runtime/docker-container-runtime.service";

const DEFAULT_STREAM_REFRESH_INTERVAL_MS = 1_000;
const MAX_SEEN_LOG_KEYS = 3_000;

@Injectable()
export class DockerContainerLogsDomainService {
  constructor(
    private readonly dockerContainerRuntimeService: DockerContainerRuntimeService,
    private readonly dockerContainerRuntimeMeshService: DockerContainerRuntimeMeshService,
  ) {}

  streamContainerLogs(input: DockerContainerLogsStreamQueryInput): Observable<DockerContainerLogEntry> {
    return this.dockerContainerRuntimeService.streamContainerLogs(input).pipe(
      catchError((error) => {
        if (!this.isContainerNotFoundLikeError(error)) {
          return throwError(() => error);
        }

        return this.streamContainerLogsFromMesh(input);
      }),
    );
  }

  async listContainerLogs(input: DockerContainerLogsStreamQueryInput) {
    return this.withContainerMeshFallback(
      () => this.dockerContainerRuntimeService.listContainerLogsSnapshot(input),
      async () => {
        const response = await this.getFirstResponse(
          this.dockerContainerRuntimeMeshService.listContainerLogsSnapshotAcrossInstances(
            {
              query: input,
            },
            {
              timeoutMs: 1_500,
              maxCollectedResponses: 1,
              stopWhen: () => true,
            },
          ),
        );

        return response?.snapshot ?? null;
      },
    );
  }

  async listContainerProcesses(input: DockerContainerProcessesQueryInput) {
    return this.withContainerMeshFallback(
      () => this.dockerContainerRuntimeService.listContainerProcesses(input),
      async () => {
        const response = await this.getFirstResponse(
          this.dockerContainerRuntimeMeshService.listContainerProcessesSnapshotAcrossInstances(
            {
              query: input,
            },
            {
              timeoutMs: 1_500,
              maxCollectedResponses: 1,
              stopWhen: () => true,
            },
          ),
        );

        return response?.snapshot ?? null;
      },
    );
  }

  streamContainerProcesses(input: DockerContainerProcessesStreamQueryInput) {
    return this.dockerContainerRuntimeService.streamContainerProcesses(input).pipe(
      catchError((error) => {
        if (!this.isContainerNotFoundLikeError(error)) {
          return throwError(() => error);
        }

        return this.streamContainerProcessesFromMesh(input);
      }),
    );
  }

  streamContainerProcessLogs(input: DockerContainerProcessLogsStreamQueryInput) {
    return this.dockerContainerRuntimeService.streamContainerProcessLogs(input).pipe(
      catchError((error) => {
        if (!this.isContainerNotFoundLikeError(error)) {
          return throwError(() => error);
        }

        return this.streamContainerProcessLogsFromMesh(input);
      }),
    );
  }

  private async withContainerMeshFallback<T>(
    localOperation: () => Promise<T>,
    meshOperation: () => Promise<T | null>,
  ): Promise<T> {
    try {
      return await localOperation();
    } catch (error) {
      if (!this.isContainerNotFoundLikeError(error)) {
        throw error;
      }

      const meshValue = await meshOperation();
      if (meshValue !== null) {
        return meshValue;
      }

      throw error;
    }
  }

  private streamContainerLogsFromMesh(input: DockerContainerLogsStreamQueryInput): Observable<DockerContainerLogEntry> {
    return new Observable<DockerContainerLogEntry>((subscriber) => {
      const seenKeys: string[] = [];
      const seenSet = new Set<string>();

      const subscription = interval(input.refreshIntervalMs ?? DEFAULT_STREAM_REFRESH_INTERVAL_MS)
        .pipe(
          startWith(0),
          switchMap(() => from(
            this.dockerContainerRuntimeMeshService.listContainerLogsSnapshotAcrossInstances(
              {
                query: input,
              },
              {
                timeoutMs: 1_500,
                maxCollectedResponses: 1,
                stopWhen: () => true,
              },
            ),
          )),
        )
        .subscribe({
          next: (result) => {
            const entries = result.responses[0]?.snapshot.entries ?? [];
            for (const entry of entries) {
              const seenKey = `${entry.timestamp}|${entry.stream}|${entry.message}`;
              if (seenSet.has(seenKey)) {
                continue;
              }

              seenSet.add(seenKey);
              seenKeys.push(seenKey);

              if (seenKeys.length > MAX_SEEN_LOG_KEYS) {
                const oldest = seenKeys.shift();
                if (oldest) {
                  seenSet.delete(oldest);
                }
              }

              subscriber.next(entry);
            }
          },
          error: (error) => subscriber.error(error),
        });

      return () => {
        subscription.unsubscribe();
      };
    });
  }

  private streamContainerProcessesFromMesh(
    input: DockerContainerProcessesStreamQueryInput,
  ): Observable<{ generatedAt: string; data: DockerContainerProcessEntry[] }> {
    const refreshIntervalMs = input.refreshIntervalMs ?? DEFAULT_STREAM_REFRESH_INTERVAL_MS;

    return interval(refreshIntervalMs).pipe(
      startWith(0),
      switchMap(() => from(this.dockerContainerRuntimeMeshService.listContainerProcessesSnapshotAcrossInstances(
        {
          query: {
            containerId: input.containerId,
          },
        },
        {
          timeoutMs: 1_500,
          maxCollectedResponses: 1,
          stopWhen: () => true,
        },
      ))),
      switchMap((result) => {
        const snapshot = result.responses[0]?.snapshot;
        if (!snapshot) {
          return from([] as Array<{ generatedAt: string; data: DockerContainerProcessEntry[] }>);
        }

        return from([
          {
            generatedAt: snapshot.generatedAt,
            data: snapshot.data,
          },
        ]);
      }),
    );
  }

  private streamContainerProcessLogsFromMesh(input: DockerContainerProcessLogsStreamQueryInput): Observable<DockerContainerLogEntry> {
    return new Observable<DockerContainerLogEntry>((subscriber) => {
      const seenKeys: string[] = [];
      const seenSet = new Set<string>();

      const subscription = interval(input.refreshIntervalMs ?? DEFAULT_STREAM_REFRESH_INTERVAL_MS)
        .pipe(
          startWith(0),
          switchMap(() => from(
            this.dockerContainerRuntimeMeshService.listContainerProcessLogsSnapshotAcrossInstances(
              {
                query: input,
              },
              {
                timeoutMs: 1_500,
                maxCollectedResponses: 1,
                stopWhen: () => true,
              },
            ),
          )),
        )
        .subscribe({
          next: (result) => {
            const entries = result.responses[0]?.snapshot.entries ?? [];
            for (const entry of entries) {
              const seenKey = `${entry.timestamp}|${entry.stream}|${entry.message}`;
              if (seenSet.has(seenKey)) {
                continue;
              }

              seenSet.add(seenKey);
              seenKeys.push(seenKey);

              if (seenKeys.length > MAX_SEEN_LOG_KEYS) {
                const oldest = seenKeys.shift();
                if (oldest) {
                  seenSet.delete(oldest);
                }
              }

              subscriber.next(entry);
            }
          },
          error: (error) => subscriber.error(error),
        });

      return () => {
        subscription.unsubscribe();
      };
    });
  }

  private async getFirstResponse<T>(call: Promise<{ responses: T[] }>): Promise<T | null> {
    const result = await call;
    return result.responses[0] ?? null;
  }

  private isContainerNotFoundLikeError(error: unknown): boolean {
    const message = this.formatError(error).toLowerCase();
    return (
      message.includes("no such container")
      || (message.includes("container") && message.includes("not found"))
      || (message.includes("404") && message.includes("container"))
    );
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === "string") {
      return error;
    }

    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
}
