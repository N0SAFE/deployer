import { Data } from "effect";

/** Domain error. The service knows nothing about HTTP or oRPC codes. */
export class PlanetNameConflict extends Data.TaggedError("PlanetNameConflict")<{
  readonly name: string;
}> {}
