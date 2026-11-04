import { createModuleContext } from "../src/effect";
import { MeshClock } from "../src/modules/platform/services/mesh-clock.service";
import { LeaseSigner } from "../src/modules/platform/services/lease-signer.service";

/**
 * VIOLATIONS `requirementFlow`, the declaration checks:
 * - `LeaseSigner` is exported but this module neither provides nor imports it (`unknownExport`);
 * - `MeshClock` is provided twice, so the second silently replaces the first (`duplicateProvider`).
 */
export const BrokenExportsModule = createModuleContext({
	providers: [
		{ provide: MeshClock, useValue: MeshClock.live },
		{ provide: MeshClock, useValue: MeshClock.live },
	],
	exports: [MeshClock, LeaseSigner],
});
