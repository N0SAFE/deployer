import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Context, Option } from "effect";
import { describe, expect, it, vi } from "vitest";

import { AppModule } from "./app.module";
import {
	assertRequirementsMet,
	createModuleContext,
	declareModule,
	EffectContextOf,
	EffectRuntime,
	EffectRuntimeModule,
	procedure,
	requires,
} from "./effect";
import { AuditTrail } from "./modules/audit/services/audit-trail.service";
import { DirectoryReaderController } from "./modules/consumer/controllers/directory-reader.controller";
import { directoryContract, relayContract } from "./modules/mesh/contracts/mesh.contract";
import { MeshDirectoryController } from "./modules/mesh/controllers/mesh-directory.controller";
import { MeshRelayController } from "./modules/mesh/controllers/mesh-relay.controller";
import { MeshDomainModule } from "./modules/mesh/mesh.module";
import { MeshDirectory } from "./modules/mesh/services/directory.service";
import { ReplicaStore } from "./modules/mesh/services/replica-store.service";
import { MeshRelay } from "./modules/mesh/services/relay.service";
import { PlatformModule } from "./modules/platform/platform.module";
import { LeaseSigner } from "./modules/platform/services/lease-signer.service";
import { MeshClock } from "./modules/platform/services/mesh-clock.service";

/**
 * Runtime behaviour: the requirement machinery is type-only, so what has to hold at runtime is that it changes nothing.
 * The middleware still guards `effect/context`, the factory still hands Nest real metadata, and the app still serves.
 */

type MiddlewareOptions = {
	readonly context: Record<string, unknown>;
	readonly next: (options: { readonly context: Record<string, unknown> }) => unknown;
};

const invoke = (middleware: unknown, options: Partial<MiddlewareOptions> = {}): unknown =>
	(middleware as (opts: MiddlewareOptions) => unknown)({
		context: {},
		next: () => undefined,
		...options,
	});

describe("createModuleContext", () => {
	it("hands Nest the metadata it was given", () => {
		expect(Reflect.getMetadata("controllers", MeshDomainModule)).toEqual([
			MeshDirectoryController,
			MeshRelayController,
		]);
		expect(Reflect.getMetadata("providers", MeshDomainModule)).toHaveLength(3);
		// The platform is global: the mesh uses it without importing it, exactly like Nest's `@Global()`.
		expect(Reflect.getMetadata("imports", MeshDomainModule)).toBeUndefined();
		expect(Reflect.getMetadata("imports", AppModule)).toContain(PlatformModule);
	});

	it("keeps the chain wrapped after $context and $config", () => {
		const contextual = procedure(relayContract.forward).$context<{ tenant: string }>();

		expect(typeof contextual.effect).toBe("function");
		expect(typeof contextual.$config({}).effect).toBe("function");
	});

	it("keeps router procedures usable and delegated", () => {
		const implementation = procedure({ directory: directoryContract, relay: relayContract });

		expect(typeof implementation.directory.register.effect).toBe("function");
		expect(typeof implementation.relay.forward.use).toBe("function");
	});

	it("is a Nest class, not a wrapper object", () => {
		expect(typeof MeshDomainModule).toBe("function");
		expect(MeshDomainModule.prototype).toBeInstanceOf(Object);
	});

	it("still guards the Effect context on its own middleware", () => {
		expect(() => invoke(MeshDomainModule[EffectContextOf])).toThrow(/effect\/context is not configured/);
	});
});

describe("declareModule", () => {
	@Module({})
	class ForeignModule {}

	it("returns the very same module", () => {
		expect(declareModule(ForeignModule, { provides: [] })).toBe(ForeignModule);
	});

	it("rejects a claim Nest does not back", () => {
		@Module({ providers: [{ provide: MeshClock, useValue: MeshClock.live }] })
		class HonestModule {}

		class Unprovided extends Context.Service<Unprovided, { readonly ok: boolean }>()(
			"demo/Unprovided",
		) {}

		expect(() => declareModule(HonestModule, { provides: [Unprovided] })).toThrow(
			/claims to provide Unprovided/,
		);
	});

	it("accepts a claim Nest backs", () => {
		@Module({ providers: [{ provide: MeshClock, useValue: MeshClock.live }] })
		class HonestModule {}

		expect(() => declareModule(HonestModule, { provides: [MeshClock] })).not.toThrow();
	});

	it("adds no runtime metadata", () => {
		const declared = declareModule(ForeignModule, { provides: [] });

		expect(Reflect.getMetadata("providers", declared)).toBeUndefined();
		expect(Object.getOwnPropertySymbols(declared)).toHaveLength(0);
	});
});

describe("assertRequirementsMet", () => {
	it("returns the module unchanged", () => {
		expect(assertRequirementsMet(AppModule)).toBe(AppModule);
	});

	it("throws nothing and runs nothing", () => {
		expect(() => assertRequirementsMet(createModuleContext({}))).not.toThrow();
	});
});

describe("requires", () => {
	it("rejects a request without an Effect context", () => {
		expect(() => invoke(requires(MeshDirectory))).toThrow(/effect\/context is not configured/);
	});

	it("forwards the runtime context untouched", () => {
		const effectContext = Context.empty();
		const next = vi.fn((options: { readonly context: Record<string, unknown> }) => options);

		const result = invoke(requires(MeshDirectory), {
			context: { "effect/context": effectContext },
			next,
		});

		expect(next).toHaveBeenCalledTimes(1);
		expect(result).toEqual({ context: { "effect/context": effectContext } });
	});
});

describe("composition", () => {
	it("serves an endpoint once every requirement is provided", async () => {
		const app = await NestFactory.create(AppModule, { logger: false });
		await app.listen(0, "127.0.0.1");

		try {
			const url = await app.getUrl();

			const response = await fetch(`${url}/directory/replicas`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ service: "projects", replicaId: "r1", address: "ws://10.0.0.2" }),
			});

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toMatchObject({
				service: "projects",
				replicaId: "r1",
				address: "ws://10.0.0.2",
			});

			// A different module, which only imports the mesh: only its exports are reachable.
			const consumer = await fetch(`${url}/consumer/directory`);
			expect(consumer.status).toBe(200);
			await expect(consumer.json()).resolves.toMatchObject({
				replicas: [expect.objectContaining({ replicaId: "r1" })],
			});
		} finally {
			await app.close();
		}
	});

	it("gives each controller its module's context, not the whole container", async () => {
		const app = await NestFactory.create(AppModule, { logger: false });

		try {
			const runtime = app.get(EffectRuntime);
			const context = runtime.contextFor(MeshDirectoryController);

			// Its own providers, its imports' exports, and the global platform.
			expect(Option.isSome(Context.getOption(context, MeshDirectory))).toBe(true);
			expect(Option.isSome(Context.getOption(context, ReplicaStore))).toBe(true);
			expect(Option.isSome(Context.getOption(context, MeshClock))).toBe(true);
			expect(Option.isSome(Context.getOption(context, LeaseSigner))).toBe(true);

			// A sibling branch the mesh never imports: registered in the container, out of this context.
			expect(Option.isSome(Context.getOption(context, AuditTrail))).toBe(false);
			expect(app.get(AuditTrail)).toBeDefined();

			// The consumer gets the mesh's exports — and only those.
			const consumer = runtime.contextFor(DirectoryReaderController);
			expect(Option.isSome(Context.getOption(consumer, MeshDirectory))).toBe(true);
			expect(Option.isSome(Context.getOption(consumer, ReplicaStore))).toBe(true);
			expect(Option.isSome(Context.getOption(consumer, MeshRelay))).toBe(false);
		} finally {
			await app.close();
		}
	});

	it("reports what each controller can reach outside its module", async () => {
		const app = await NestFactory.create(AppModule, { logger: false });

		try {
			const report = app.get(EffectRuntime).scopeReport();
			const byController = (name: string) => report.find((row) => row.controller === name);

			// The mesh never imports the audit branch: it is registered, and out of scope.
			expect(byController("MeshDirectoryController")?.outOfScope).toContain("AuditTrail");
			// The consumer imports the mesh, so it sees the exports — but `MeshRelay` was never exported.
			expect(byController("DirectoryReaderController")?.outOfScope).toContain("MeshRelay");
		} finally {
			await app.close();
		}
	});

	it("keeps the runtime context discoverable", () => {
		expect(AppModule).toBeDefined();
		expect(EffectRuntimeModule).toBeDefined();
		expect(EffectRuntime).toBeTypeOf("function");
	});
});
