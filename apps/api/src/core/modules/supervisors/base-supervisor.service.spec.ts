import { describe, expect, it } from "vitest";
import z from "zod/v4";
import {
	BaseSupervisorService,
	baseSupervisorPayloadSchema,
	type SupervisorProbeResult,
} from "./base-supervisor.service";
import { baseSupervisorProcessInfoSchema } from "./supervisor-process-info";

const testPayloadSchema = baseSupervisorPayloadSchema.extend({ n: z.number().int() });
type TestPayload = z.output<typeof testPayloadSchema>;

/** Multi-instance supervisor using the static-identifier pattern. */
class MultiInstanceSupervisor extends BaseSupervisorService<typeof testPayloadSchema> {
	static readonly identifier = "multi";
	readonly description = "multi-instance test supervisor";
	readonly payloadSchema = testPayloadSchema;
	readonly processInfoSchema = baseSupervisorProcessInfoSchema;

	constructor(private readonly instanceKey: string) {
		super();
	}

	protected getIdentifierInput() {
		return { instance: this.instanceKey };
	}

	protected async reconcile(): Promise<void> {}

	protected async probe(): Promise<SupervisorProbeResult<typeof testPayloadSchema>> {
		return this.raiseRuntimeError();
	}

	// Unused, but required by the abstract contract.
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	private raiseRuntimeError(): Promise<SupervisorProbeResult<typeof testPayloadSchema>> {
		throw new Error("not probed in identifier tests");
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	protected buildDegradedPayload(_detail: string): TestPayload {
		return { checkedAt: new Date().toISOString(), latencyMs: 0, n: 0 };
	}

	protected async buildProcessInfo(): Promise<Record<string, unknown>> {
		return { kind: "test" };
	}
}

/** Single-instance supervisor using the static-identifier pattern. */
class SingleInstanceSupervisor extends BaseSupervisorService<typeof testPayloadSchema> {
	static readonly identifier = "single";
	readonly description = "single-instance test supervisor";
	readonly payloadSchema = testPayloadSchema;
	readonly processInfoSchema = baseSupervisorProcessInfoSchema;

	protected async reconcile(): Promise<void> {}

	protected async probe(): Promise<SupervisorProbeResult<typeof testPayloadSchema>> {
		return this.raiseRuntimeError();
	}

	private raiseRuntimeError(): Promise<SupervisorProbeResult<typeof testPayloadSchema>> {
		throw new Error("not probed in identifier tests");
	}

	protected buildDegradedPayload(_detail: string): TestPayload {
		return { checkedAt: new Date().toISOString(), latencyMs: 0, n: 0 };
	}

	protected async buildProcessInfo(): Promise<Record<string, unknown>> {
		return { kind: "test" };
	}
}

describe("BaseSupervisorService.getIdentifier", () => {
	it("returns the static identifier without input (single-instance)", () => {
		expect(SingleInstanceSupervisor.getIdentifier()).toBe("single");
	});

	it("is referenced via the class, never a duplicated literal", () => {
		// The pattern: ImplementedSupervisor.getIdentifier() everywhere.
		const id = SingleInstanceSupervisor.getIdentifier();
		expect(id).toBe("single");
		// A registered instance computes the SAME id lazily from the class.
		const instance = new SingleInstanceSupervisor();
		expect(instance.supervisorId).toBe(SingleInstanceSupervisor.getIdentifier());
	});

	it("produces a unique deterministic hash per input (multi-instance)", () => {
		const a = MultiInstanceSupervisor.getIdentifier({ instance: "acme" });
		const b = MultiInstanceSupervisor.getIdentifier({ instance: "beta" });
		const a2 = MultiInstanceSupervisor.getIdentifier({ instance: "acme" });

		expect(a).toMatch(/^multi:[0-9a-f]{12}$/);
		expect(a).not.toBe(b); // different instance → unique id
		expect(a).toBe(a2); // deterministic
	});

	it("assigns the unique hashed id to each created instance (once)", () => {
		const acme = new MultiInstanceSupervisor("acme");
		const beta = new MultiInstanceSupervisor("beta");
		expect(acme.supervisorId).toBe(MultiInstanceSupervisor.getIdentifier({ instance: "acme" }));
		expect(beta.supervisorId).toBe(MultiInstanceSupervisor.getIdentifier({ instance: "beta" }));
		expect(acme.supervisorId).not.toBe(beta.supervisorId);
	});

	it("keeps the plain-number input hash stable too", () => {
		const n1 = MultiInstanceSupervisor.getIdentifier(42);
		expect(MultiInstanceSupervisor.getIdentifier(42)).toBe(n1);
		expect(MultiInstanceSupervisor.getIdentifier(43)).not.toBe(n1);
	});
});