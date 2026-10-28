import { describe, expect, it } from "vitest";

import { BaseDatabaseService } from "./base-database.service";

class HarnessDatabaseService extends BaseDatabaseService<never> {}

describe("BaseDatabaseService", () => {
	it("throws DATABASE_NOT_INITIALIZED when read before init", () => {
		expect(() => new HarnessDatabaseService().db).toThrow("has not been initialized yet");
	});

	it("holds the connection it was given", () => {
		const connection = { run: () => undefined } as never;
		const service = new HarnessDatabaseService(connection);
		expect(service.isInitialized).toBe(true);
		expect(service.db).toBe(connection);
	});

	it("probes a run-capable handle as healthy and an empty one as unhealthy", async () => {
		expect(await new HarnessDatabaseService({ run: () => undefined } as never).probe()).toBe(true);
		expect(await new HarnessDatabaseService({} as never).probe()).toBe(false);
		expect(await new HarnessDatabaseService().probe()).toBe(false);
	});
});
