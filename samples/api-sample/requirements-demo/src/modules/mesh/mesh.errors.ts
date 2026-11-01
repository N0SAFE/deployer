import { Data } from "effect";

/** The one domain error of the directory: a service with no live replica. */
export class MeshNoReplica extends Data.TaggedError("MeshNoReplica")<{ readonly service: string }> {}
