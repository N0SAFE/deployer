import { Controller, Module } from "@nestjs/common";
import { describe, expectTypeOf, it } from "vitest";

import {
	AllServicesOfModule,
	assertRequirementsMet,
	createModuleContext,
	declareModule,
	type MetadataInput,
	type Missing,
	type ModuleServices,
	procedure,
	type RequiredBy,
	requires,
	type RequirementsMet,
	UnmetOf,
} from "./effect";
import { AppModule } from "./app.module";
import { ConsumerModule } from "./modules/consumer/consumer.module";
import { DirectoryReaderController } from "./modules/consumer/controllers/directory-reader.controller";
import { AuditTrail } from "./modules/audit/services/audit-trail.service";
import { directoryContract, relayContract } from "./modules/mesh/contracts/mesh.contract";
import { MeshDirectoryController } from "./modules/mesh/controllers/mesh-directory.controller";
import { MeshRelayController } from "./modules/mesh/controllers/mesh-relay.controller";
import { MeshDomainModule } from "./modules/mesh/mesh.module";
import { MeshDirectory } from "./modules/mesh/services/directory.service";
import { MeshRelay } from "./modules/mesh/services/relay.service";
import { ReplicaStore } from "./modules/mesh/services/replica-store.service";
import { PlatformModule } from "./modules/platform/platform.module";
import { MeshClock } from "./modules/platform/services/mesh-clock.service";
import { LeaseSigner } from "./modules/platform/services/lease-signer.service";

/**
 * The type-level contract, checked by `vitest --typecheck`.
 *
 * Every assertion here is a claim the architecture makes about Nest's module graph. If one stops holding, the typecheck
 * run fails with the expected and actual types side by side.
 */

/** An endpoint as it is written: `procedure(...).effect(...)`, requirements inferred from the body. */
const bareEndpoint = procedure(relayContract.forward).effect(function* () {
	const relay = yield* MeshRelay;
	return yield* relay.forward("r1");
});

/** The same, behind a middleware — the `RequirementProcedure` facade must hold at every step of the chain. */
const middlewareEndpoint = procedure(relayContract.forward)
	.use(requires(MeshRelay))
	.effect(function* () {
		const relay = yield* MeshRelay;
		return yield* relay.forward("r1");
	});

/** A router contract stays a router: every procedure key keeps the typed `.effect`. */
const meshRouter = { directory: directoryContract, relay: relayContract };

const routed = procedure(meshRouter).directory.register.effect(function* ({ input }) {
	const directory = yield* MeshDirectory;
	return yield* directory.register(input);
});

/** An explicit initial-context generic is forwarded into the handler. */
const contextual = procedure<typeof relayContract.forward, { readonly tenant: string }>(
	relayContract.forward,
).effect(function* ({ context }) {
	void context.tenant;
	const relay = yield* MeshRelay;
	return yield* relay.forward("r1");
});

/** A controller that needs `MeshClock` and provides nothing: the unit all the visibility cases are built from. */
@Controller()
class ClockController {
	read() {
		return procedure(relayContract.forward).effect(function* () {
			const clock = yield* MeshClock;
			return { accepted: clock.now() > 0 };
		});
	}
}

const ClockModule = createModuleContext({ controllers: [ClockController] });

/** Provides `MeshClock` but exports nothing: the classic private provider. */
const HiddenClockModule = createModuleContext({
	providers: [{ provide: MeshClock, useValue: MeshClock.live }],
});

/** Provides and exports it. */
const SharedClockModule = createModuleContext({
	providers: [{ provide: MeshClock, useValue: MeshClock.live }],
	exports: [MeshClock],
});

/** Re-exports `SharedClockModule`: `exports: [Module]` forwards that module's exports, as in Nest. */
const ReExportingClockModule = createModuleContext({
	imports: [SharedClockModule],
	exports: [SharedClockModule],
});

/** The composition root of the failing cases: imports a module that cannot resolve itself. */
const ClockRootModule = createModuleContext({ imports: [ClockModule] });

/** Generics are forwarded: the wrapper contributes nothing of its own. */
const withMetadata = <const M extends MetadataInput>(metadata: M) => createModuleContext(metadata);
const WrappedClockModule = withMetadata({ controllers: [ClockController] });

describe("Nest visibility", () => {
	it("a module sees its own providers", () => {
		const own = createModuleContext({
			controllers: [ClockController],
			providers: [{ provide: MeshClock, useValue: MeshClock.live }],
		});

		expectTypeOf<UnmetOf<typeof own>>().toEqualTypeOf<never>();
	});

	it("an import's private providers stay private", () => {
		const consumer = createModuleContext({
			imports: [HiddenClockModule],
			controllers: [ClockController],
		});

		expectTypeOf<UnmetOf<typeof consumer>>().toEqualTypeOf<[ClockController, MeshClock]>();
		expectTypeOf<ModuleServices<typeof consumer>>().toEqualTypeOf<never>();
	});

	it("an import's exports are visible", () => {
		const consumer = createModuleContext({
			imports: [SharedClockModule],
			controllers: [ClockController],
		});

		expectTypeOf<UnmetOf<typeof consumer>>().toEqualTypeOf<never>();
		expectTypeOf<ModuleServices<typeof consumer>>().toEqualTypeOf<MeshClock>();
	});

	it("exporting a module re-exports its exports", () => {
		const consumer = createModuleContext({
			imports: [ReExportingClockModule],
			controllers: [ClockController],
		});

		expectTypeOf<UnmetOf<typeof consumer>>().toEqualTypeOf<never>();
	});

	it("a parent's providers do not reach a child", () => {
		const parent = createModuleContext({
			providers: [{ provide: MeshClock, useValue: MeshClock.live }],
			imports: [ClockModule],
		});

		expectTypeOf<UnmetOf<typeof parent>>().toEqualTypeOf<[ClockController, MeshClock]>();
	});
});

describe("exports are load-bearing", () => {
	/** The same mesh, but exporting the service without its collaborator. */
	const NarrowMesh = createModuleContext({
		controllers: [MeshDirectoryController, MeshRelayController],
		providers: [
			{ provide: ReplicaStore, useValue: ReplicaStore.live },
			{ provide: MeshDirectory, useValue: MeshDirectory.live },
			{ provide: MeshRelay, useValue: MeshRelay.live },
		],
		exports: [MeshDirectory],
	});

	const NarrowConsumer = createModuleContext({
		imports: [NarrowMesh],
		controllers: [DirectoryReaderController],
	});

	const NarrowRoot = createModuleContext({
		imports: [PlatformModule, NarrowMesh, NarrowConsumer],
	});

	it("an export that drags a collaborator the module does not export leaves the consumer short", () => {
		expectTypeOf<UnmetOf<typeof NarrowConsumer>>().toEqualTypeOf<
			| [DirectoryReaderController, ReplicaStore | MeshClock]
			| [MeshDirectoryController, MeshClock | LeaseSigner]
			| [MeshRelayController, LeaseSigner]
		>();

		// @ts-expect-error — `ReplicaStore` runs behind `MeshDirectory` and never crosses the boundary.
		assertRequirementsMet(NarrowRoot);
	});
});

describe("a module's requirements", () => {
	it("leave a global's services for the root to resolve", () => {
		expectTypeOf<UnmetOf<typeof MeshDomainModule>>().toEqualTypeOf<
			| [MeshDirectoryController, MeshClock | LeaseSigner]
			| [MeshRelayController, LeaseSigner]
		>();
	});

	it("are empty for a module that only provides", () => {
		expectTypeOf<UnmetOf<typeof PlatformModule>>().toEqualTypeOf<never>();
	});

	it("are resolved by the composition root, globals included", () => {
		expectTypeOf<RequirementsMet<typeof AppModule>>().toEqualTypeOf<typeof AppModule>();
	});

	it("surface at the root when a module cannot resolve them", () => {
		expectTypeOf<UnmetOf<typeof ClockModule>>().toEqualTypeOf<[ClockController, MeshClock]>();
		expectTypeOf<UnmetOf<typeof ClockRootModule>>().toEqualTypeOf<[ClockController, MeshClock]>();
	});

	it("survive a generic wrapper", () => {
		expectTypeOf<UnmetOf<typeof WrappedClockModule>>().toEqualTypeOf<[ClockController, MeshClock]>();
	});
});

describe("a module's context", () => {
	it("is what it provides", () => {
		expectTypeOf<ModuleServices<typeof PlatformModule>>().toEqualTypeOf<MeshClock | LeaseSigner>();
	});

	it("is its providers plus its imports' exports", () => {
		expectTypeOf<ModuleServices<typeof MeshDomainModule>>().toEqualTypeOf<
			MeshDirectory | MeshRelay | ReplicaStore
		>();
	});

	it("includes the exports of its imports", () => {
		expectTypeOf<ModuleServices<typeof AppModule>>().toEqualTypeOf<
			MeshDirectory | ReplicaStore | MeshClock | LeaseSigner
		>();
	});

	it("is exactly the exports for a module that provides nothing", () => {
		expectTypeOf<ModuleServices<typeof ConsumerModule>>().toEqualTypeOf<MeshDirectory | ReplicaStore>();
	});

	it("carries the subtree's unresolved requirements", () => {
		expectTypeOf<UnmetOf<typeof ConsumerModule>>().toEqualTypeOf<
			| [DirectoryReaderController, MeshClock]
			| [MeshDirectoryController, MeshClock | LeaseSigner]
			| [MeshRelayController, LeaseSigner]
		>();
	});

	it("the container holds every provider in the tree", () => {
		expectTypeOf<AllServicesOfModule<typeof AppModule>>().toEqualTypeOf<
			AuditTrail | MeshDirectory | MeshRelay | ReplicaStore | MeshClock | LeaseSigner
		>();
	});
});

describe("a missing provider names its controller", () => {
	/** The relay controller, in a module that forgets to provide `MeshRelay`. */
	const RelayWithoutProvider = createModuleContext({
		imports: [PlatformModule],
		controllers: [MeshRelayController],
		providers: [{ provide: ReplicaStore, useValue: ReplicaStore.live }],
	});
	const RelayRoot = createModuleContext({ imports: [RelayWithoutProvider] });

	it("points at the controller and the service, not just the service", () => {
		expectTypeOf<UnmetOf<typeof RelayWithoutProvider>>().toEqualTypeOf<
			[MeshRelayController, MeshRelay]
		>();
	});

	it("survives the trip to the composition root", () => {
		expectTypeOf<UnmetOf<typeof RelayRoot>>().toEqualTypeOf<[MeshRelayController, MeshRelay]>();
		expectTypeOf<RequirementsMet<typeof RelayRoot>>().toEqualTypeOf<
			Missing<[MeshRelayController, MeshRelay]>
		>();

		// @ts-expect-error — `MeshRelay` is used by `MeshRelayController` and provided nowhere.
		assertRequirementsMet(RelayRoot);
	});
});

describe("an endpoint's declaration", () => {
	it("reads the services its body yields", () => {
		expectTypeOf<RequiredBy<ReturnType<MeshDirectoryController["register"]>>>().toEqualTypeOf<
			MeshDirectory | ReplicaStore | MeshClock | LeaseSigner
		>();
	});

	it("includes the collaborators of a single service", () => {
		expectTypeOf<RequiredBy<ReturnType<MeshRelayController["forward"]>>>().toEqualTypeOf<
			MeshRelay | ReplicaStore | LeaseSigner
		>();
	});

	it("keeps a router contract a router", () => {
		expectTypeOf<RequiredBy<typeof routed>>().toEqualTypeOf<
			MeshDirectory | ReplicaStore | MeshClock | LeaseSigner
		>();
	});

	it("forwards an explicit initial context", () => {
		expectTypeOf<RequiredBy<typeof contextual>>().toEqualTypeOf<MeshRelay | ReplicaStore | LeaseSigner>();
	});

	it("is inferred from the body, with no wiring line", () => {
		expectTypeOf<RequiredBy<typeof bareEndpoint>>().toEqualTypeOf<MeshRelay | ReplicaStore | LeaseSigner>();
	});

	it("survives a middleware in front of it", () => {
		expectTypeOf<RequiredBy<typeof middlewareEndpoint>>().toEqualTypeOf<
			MeshRelay | ReplicaStore | LeaseSigner
		>();
	});
});

describe("global modules", () => {
	const GlobalClockModule = createModuleContext(
		{
			providers: [{ provide: MeshClock, useValue: MeshClock.live }],
			exports: [MeshClock],
		},
		{ global: true },
	);

	const GlobalRoot = createModuleContext({ imports: [GlobalClockModule, ClockModule] });
	const PlainRoot = createModuleContext({ imports: [ClockModule] });

	it("are visible without being imported", () => {
		expectTypeOf<RequirementsMet<typeof GlobalRoot>>().toEqualTypeOf<typeof GlobalRoot>();
	});

	it("are not needed for a module that resolves itself", () => {
		expectTypeOf<RequirementsMet<typeof PlainRoot>>().not.toEqualTypeOf<typeof PlainRoot>();
	});

	it("a foreign module can be declared global", () => {
		expectTypeOf<RequirementsMet<typeof AppModule>>().toEqualTypeOf<typeof AppModule>();
	});
});

describe("the root gate", () => {
	it("accepts a resolved root", () => {
		expectTypeOf(assertRequirementsMet).toBeCallableWith(AppModule);
	});

	it("rejects an unresolved root", () => {
		// `toBeCallableWith` throws a TypeCheckError when the expression is `never`-callable, so the proof is the
		// directive: it fails the run if this call ever compiles.
		// @ts-expect-error — the clock module needs `MeshClock`, which nothing it imports exports.
		assertRequirementsMet(ClockRootModule);
	});

	it("names the missing services in the error type", () => {
		expectTypeOf<RequirementsMet<typeof ClockRootModule>>().toEqualTypeOf<
			Missing<[ClockController, MeshClock]>
		>();
	});
});

describe("a foreign module", () => {
	@Module({})
	class LegacyModule {}

	const Audit = declareModule(LegacyModule, { provides: [], exports: [] });
	const WithAudit = createModuleContext({ imports: [Audit], controllers: [ClockController] });

	it("declares nothing it does not provide", () => {
		expectTypeOf<UnmetOf<typeof Audit>>().toEqualTypeOf<never>();
	});

	it("contributes only its exports to its importers", () => {
		expectTypeOf<ModuleServices<typeof WithAudit>>().toEqualTypeOf<never>();
		expectTypeOf<UnmetOf<typeof WithAudit>>().toEqualTypeOf<[ClockController, MeshClock]>();
	});

	it("contributes what it claims when annotated", () => {
		expectTypeOf<ModuleServices<typeof PlatformModule>>().toEqualTypeOf<MeshClock | LeaseSigner>();
	});
});
