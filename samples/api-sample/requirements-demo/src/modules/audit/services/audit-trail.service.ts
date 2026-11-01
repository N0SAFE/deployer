import { Context } from "effect";

export type AuditTrailShape = {
	readonly record: (message: string) => void;
};

/** A service from a branch the mesh has no business reaching: it exists to prove the runtime scoping. */
export class AuditTrail extends Context.Service<AuditTrail, AuditTrailShape>()("demo/AuditTrail") {
	static readonly live: AuditTrailShape = { record: () => undefined };
}
