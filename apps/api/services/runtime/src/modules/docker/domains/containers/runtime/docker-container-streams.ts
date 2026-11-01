import type { EffectHostShape } from "@deployer/nest-effect";
import type { DockerContainerLogEntry, DockerContainerProcessEntry } from "@deployer/contracts-entities";
import type {
  DockerContainerLogsStreamQueryInput,
  DockerContainerProcessLogsStreamQueryInput,
  DockerContainerProcessesStreamQueryInput,
  DockerContainerTerminalStreamQueryInput,
} from "@deployer/runtime-contracts/modules/docker/containers/shared";
import { Effect } from "effect";
import { defer, from, switchMap, type Observable } from "rxjs";

import {
  DockerContainerAccess,
  type ContainerAccessServices,
  type DockerContainerAccessShape,
  type TerminalStreamEvent,
} from "./docker-container-access";

/** The four container streams, kept as RxJS so the oRPC streaming handlers keep their shape. */
export type DockerContainerStreamsShape = {
  readonly streamContainerLogs: (input: DockerContainerLogsStreamQueryInput) => Observable<DockerContainerLogEntry>;
  readonly streamContainerProcesses: (
    input: DockerContainerProcessesStreamQueryInput,
  ) => Observable<{ generatedAt: string; data: DockerContainerProcessEntry[] }>;
  readonly streamContainerProcessLogs: (
    input: DockerContainerProcessLogsStreamQueryInput,
  ) => Observable<DockerContainerLogEntry>;
  readonly streamContainerTerminalSession: (
    input: DockerContainerTerminalStreamQueryInput,
  ) => Observable<TerminalStreamEvent>;
};

/**
 * The RxJS boundary of the container streams: each subscription runs the access Effect on the app's `EffectHost` and
 * then subscribes to the Observable it produced. `EffectHost.run` is the only runtime touchpoint; the access service
 * itself stays an Effect constant.
 */
export function containerStreamsOver(host: EffectHostShape): DockerContainerStreamsShape {
  const stream = <A>(
    select: (access: DockerContainerAccessShape) => Effect.Effect<Observable<A>, unknown, ContainerAccessServices>,
  ): Observable<A> =>
    defer(() => from(host.runUnwrapped(Effect.flatMap(DockerContainerAccess, select)))).pipe(
      switchMap((inner) => inner),
    );

  return {
    streamContainerLogs: (input) => stream((access) => access.streamLogs(input)),
    streamContainerProcesses: (input) => stream((access) => access.streamProcesses(input)),
    streamContainerProcessLogs: (input) => stream((access) => access.streamProcessLogs(input)),
    streamContainerTerminalSession: (input) => stream((access) => access.streamTerminal(input)),
  };
}
