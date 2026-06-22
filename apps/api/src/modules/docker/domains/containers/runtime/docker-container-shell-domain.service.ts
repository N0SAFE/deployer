import { Injectable } from "@nestjs/common";
import { Observable, catchError, from, interval, map, startWith, switchMap, throwError } from "rxjs";
import type {
  DockerContainerTerminalCloseBodyInput,
  DockerContainerTerminalInputBodyInput,
  DockerContainerTerminalOpenBodyInput,
  DockerContainerTerminalStreamQueryInput,
} from "@repo/api-contracts/modules/docker/containers/shared";
import { DockerContainerRuntimeMeshService } from "../mesh/docker-container-runtime-mesh.service";
import { DockerContainerRuntimeService } from "../runtime/docker-container-runtime.service";

const TERMINAL_STREAM_REFRESH_INTERVAL_MS = 400;

interface DockerTerminalStreamEvent {
  sessionId: string;
  timestamp: Date;
  type: "output" | "status" | "error";
  data: string;
}

@Injectable()
export class DockerContainerShellDomainService {
  constructor(
    private readonly dockerContainerRuntimeService: DockerContainerRuntimeService,
    private readonly dockerContainerRuntimeMeshService: DockerContainerRuntimeMeshService,
  ) {}

  async openContainerTerminalSession(input: DockerContainerTerminalOpenBodyInput) {
    try {
      return await this.dockerContainerRuntimeService.openContainerTerminalSession(input);
    } catch (error) {
      if (!this.isContainerNotFoundLikeError(error)) {
        throw error;
      }

      const response = await this.getFirstResponse(
        this.dockerContainerRuntimeMeshService.openContainerTerminalSessionAcrossInstances(
          {
            body: input,
          },
          {
            timeoutMs: 1_500,
            maxCollectedResponses: 1,
            stopWhen: () => true,
          },
        ),
      );

      if (response) {
        return response.session;
      }

      throw error;
    }
  }

  streamContainerTerminalSession(input: DockerContainerTerminalStreamQueryInput): Observable<DockerTerminalStreamEvent> {
    return this.dockerContainerRuntimeService.streamContainerTerminalSession(input).pipe(
      map((event) => ({
        sessionId: event.sessionId,
        timestamp: this.toDate(event.timestamp),
        type: event.type,
        data: event.data,
      })),
      catchError((error) => {
        if (!this.isTerminalSessionNotFoundError(error)) {
          return throwError(() => error);
        }

        return this.streamContainerTerminalSessionFromMesh(input.sessionId);
      }),
    );
  }

  async sendContainerTerminalInput(input: DockerContainerTerminalInputBodyInput) {
    try {
      return await this.dockerContainerRuntimeService.sendContainerTerminalInput(input);
    } catch (error) {
      if (!this.isTerminalSessionNotFoundError(error)) {
        throw error;
      }

      const response = await this.getFirstResponse(
        this.dockerContainerRuntimeMeshService.sendContainerTerminalInputAcrossInstances(
          {
            body: input,
          },
          {
            timeoutMs: 1_500,
            maxCollectedResponses: 1,
            stopWhen: () => true,
          },
        ),
      );

      if (response) {
        return response.ack;
      }

      throw error;
    }
  }

  async closeContainerTerminalSession(input: DockerContainerTerminalCloseBodyInput) {
    try {
      return await this.dockerContainerRuntimeService.closeContainerTerminalSession(input);
    } catch (error) {
      if (!this.isTerminalSessionNotFoundError(error)) {
        throw error;
      }

      const response = await this.getFirstResponse(
        this.dockerContainerRuntimeMeshService.closeContainerTerminalSessionAcrossInstances(
          {
            body: input,
          },
          {
            timeoutMs: 1_500,
            maxCollectedResponses: 1,
            stopWhen: () => true,
          },
        ),
      );

      if (response) {
        return response.ack;
      }

      return {
        ok: true as const,
        timestamp: new Date(),
      };
    }
  }

  private streamContainerTerminalSessionFromMesh(sessionId: string): Observable<DockerTerminalStreamEvent> {
    return new Observable<DockerTerminalStreamEvent>((subscriber) => {
      let latestSequence = 0;

      const subscription = interval(TERMINAL_STREAM_REFRESH_INTERVAL_MS)
        .pipe(
          startWith(0),
          switchMap(() => from(
            this.dockerContainerRuntimeMeshService.listContainerTerminalSessionEventsAcrossInstances(
              {
                query: {
                  sessionId,
                  afterSequence: latestSequence,
                },
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
            const snapshot = result.responses[0]?.snapshot;
            if (!snapshot) {
              return;
            }

            const sortedEvents = [...snapshot.events].sort((left, right) => left.sequence - right.sequence);
            for (const event of sortedEvents) {
              latestSequence = Math.max(latestSequence, event.sequence);
              subscriber.next({
                sessionId: event.sessionId,
                timestamp: new Date(event.timestamp),
                type: event.type,
                data: event.data,
              });
            }

            if (snapshot.closed) {
              subscriber.complete();
            }
          },
          error: (error) => { subscriber.error(error); },
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

  private isTerminalSessionNotFoundError(error: unknown): boolean {
    const message = this.formatError(error).toLowerCase();
    return message.includes("terminal session") && message.includes("not found");
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

  private toDate(value: string | Date): Date {
    return value instanceof Date ? value : new Date(value);
  }
}
