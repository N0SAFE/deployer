import { Context, Effect } from "effect";

import { DockerEngine } from "@deployer/docker";
import type {
  DockerContainerTerminalCloseBodyInput,
  DockerContainerTerminalInputBodyInput,
  DockerContainerTerminalOpenBodyInput,
  DockerContainerTerminalStreamQueryInput,
} from "@deployer/runtime-contracts/modules/docker/containers/shared";

import { TerminalSessionManager } from "./docker-terminal-session-manager";

import type { TerminalSessionEvent } from "./container-runtime-helpers";
import type { Observable } from "rxjs";


export type DockerTerminalSessionsShape = {
  readonly open: (input: DockerContainerTerminalOpenBodyInput) => Effect.Effect<
    Awaited<ReturnType<TerminalSessionManager["openContainerTerminalSession"]>>,
    unknown,
    DockerEngine
  >;
  /** The session's output as an Observable; fails with NotFound when there is no such session. */
  readonly stream: (input: DockerContainerTerminalStreamQueryInput) => Effect.Effect<Observable<TerminalSessionEvent>, unknown>;
  readonly events: (input: { sessionId: string; afterSequence?: number }) => Effect.Effect<
    ReturnType<TerminalSessionManager["listContainerTerminalSessionEvents"]>,
    unknown
  >;
  readonly sendInput: (input: DockerContainerTerminalInputBodyInput) => Effect.Effect<
    Awaited<ReturnType<TerminalSessionManager["sendContainerTerminalInput"]>>,
    unknown
  >;
  readonly close: (input: DockerContainerTerminalCloseBodyInput) => Effect.Effect<
    Awaited<ReturnType<TerminalSessionManager["closeContainerTerminalSession"]>>,
    unknown
  >;
  /** The session ids this replica holds: announced as mesh keys so a call about a session reaches the node that owns it. */
  readonly sessionIds: () => readonly string[];
  /** Close every open session and clear their timers (the application is shutting down). */
  readonly shutdown: Effect.Effect<void>;
};

/**
 * The container terminal sessions. A constant whose sessions live in one manager created with it; the docker
 * engine is yielded from the Effect context when a session is opened and kept on the session for its later calls.
 */
export class DockerTerminalSessions extends Context.Service<DockerTerminalSessions, DockerTerminalSessionsShape>()(
  "runtime/DockerTerminalSessions",
) {
  static readonly live: DockerTerminalSessionsShape = (() => {
    const manager = new TerminalSessionManager();
    return {
      open: (input) =>
        Effect.flatMap(DockerEngine, (engine) =>
          Effect.tryPromise({ try: () => manager.openContainerTerminalSession(input, engine), catch: (error) => error }),
        ),
      stream: (input) => Effect.try({ try: () => manager.streamContainerTerminalSession(input), catch: (error) => error }),
      events: (input) => Effect.try({ try: () => manager.listContainerTerminalSessionEvents(input), catch: (error) => error }),
      sendInput: (input) => Effect.tryPromise({ try: () => manager.sendContainerTerminalInput(input), catch: (error) => error }),
      close: (input) => Effect.tryPromise({ try: () => manager.closeContainerTerminalSession(input), catch: (error) => error }),
      sessionIds: () => manager.sessionIds(),
      shutdown: Effect.sync(() => {
        manager.shutdown();
      }),
    };
  })();
}
