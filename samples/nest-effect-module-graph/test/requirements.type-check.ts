/**
 * Compile-only checks. Run by `bun run type-check`; not a runtime test.
 *
 * Each `@ts-expect-error` is the check inverted: if the requirement check ever
 * stops firing, the directive becomes unused and `tsc` fails.
 */
import { Effect } from "effect";

import {
	createModuleContext,
	type ContextOf,
	type MissingOf,
	type ProvidesOf,
} from "../src/effect-graph";
import { HealthServiceModule } from "../src/demo/app.module";
import { HealthDomainModule } from "../src/demo/health.module";
import { HealthLive, HealthRegistry, HealthService } from "../src/demo/health.service";
import { AppLifecycle } from "../src/demo/lifecycle.module";

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// The domain's context is what its layer produces plus what it imports.
const leafContext: Equal<ContextOf<typeof HealthDomainModule>, HealthRegistry | HealthService> =
	true;

// Importing chains: the root sees the registry through the domain, and the
// adapted lifecycle module through its claim.
const rootContext: Equal<
	ContextOf<typeof HealthServiceModule>,
	HealthRegistry | HealthService | AppLifecycle
> = true;
const rootProvides: Equal<
	ProvidesOf<typeof HealthServiceModule>,
	HealthRegistry | HealthService | AppLifecycle
> = true;

// Both close themselves: nothing is left for an importer to provide.
const leafClosed: Equal<MissingOf<typeof HealthDomainModule>, never> = true;
const rootClosed: Equal<MissingOf<typeof HealthServiceModule>, never> = true;

// ── the check, inverted ─────────────────────────────────────────────────────
// `HealthLive` requires `HealthRegistry`; this module imports nothing, so the
// metadata argument has to carry `__missingEffectProviders`.
// @ts-expect-error HealthRegistry is required by HealthLive and no import provides it
class LeafWithoutImport extends createModuleContext({ name: "LeafWithoutImport" }, HealthLive) {}

// A bare key is ambient: it is visible to this module's handlers, importable
// nowhere, and it is not a substitute for importing the providing module.
// @ts-expect-error HealthRegistry passed as an extra does not satisfy HealthLive
class LeafWithKeyOnly extends createModuleContext({ name: "LeafWithKeyOnly" }, HealthLive, HealthRegistry) {}

// Providing it here also closes the module — importing is not the only way.
class SelfContained extends createModuleContext(
	{
		name: "SelfContained",
		providers: [
			{
				provide: HealthRegistry,
				useValue: {
					runOnce: () => Effect.succeed({ status: "up" as const, checkedAt: "now" }),
				},
			},
		],
	},
	HealthLive,
) {}
const selfClosed: Equal<MissingOf<typeof SelfContained>, never> = true;

export const checks = [
	leafContext,
	rootContext,
	rootProvides,
	leafClosed,
	rootClosed,
	selfClosed,
	LeafWithoutImport,
	LeafWithKeyOnly,
	SelfContained,
] as const;
