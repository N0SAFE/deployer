import { firstValueFrom } from "rxjs";
import { describe, expect, it } from "vitest";

import { AppLifecyclePhase } from "@deployer/lifecycle";

import { AppLifecycleService } from "./app-lifecycle.service";

describe("AppLifecycleService observables", () => {
	it("emits changes to RxJS subscribers, filtered by phase through on()", async () => {
		const service = new AppLifecycleService();
		const ready = firstValueFrom(service.on({ phase: AppLifecyclePhase.READY }));
		await Promise.resolve();
		service.markError("boom");
		service.markReady();
		expect((await ready).phase).toBe(AppLifecyclePhase.READY);
		expect(service.phase).toBe(AppLifecyclePhase.READY);
	});
});
