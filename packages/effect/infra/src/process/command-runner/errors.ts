import { Data } from "effect";

/** The executable is not on this consumer's allow-list. */
export class ExeNotAllowed extends Data.TaggedError("ExeNotAllowed")<{ readonly exe: string }> {}
/** The command is structurally invalid (NUL byte in an argument, empty executable, ...). */
export class InvalidCommand extends Data.TaggedError("InvalidCommand")<{ readonly reason: string }> {}
/** The process could not be started (missing binary, permissions, ...). */
export class SpawnFailed extends Data.TaggedError("SpawnFailed")<{
  readonly exe: string;
  readonly message: string;
}> {}
/** The process ran and exited non-zero (or was killed by a signal). Output tail is scrubbed of secrets. */
export class CommandFailed extends Data.TaggedError("CommandFailed")<{
  readonly exe: string;
  readonly code: number | null;
  readonly signal: string | number | null;
  readonly stderrTail: string;
}> {}
export class CommandTimeout extends Data.TaggedError("CommandTimeout")<{
  readonly exe: string;
  readonly afterMs: number;
}> {}
export class OutputTooLarge extends Data.TaggedError("OutputTooLarge")<{
  readonly exe: string;
  readonly limitBytes: number;
}> {}

export type CommandError =
  | ExeNotAllowed
  | InvalidCommand
  | SpawnFailed
  | CommandFailed
  | CommandTimeout
  | OutputTooLarge;
