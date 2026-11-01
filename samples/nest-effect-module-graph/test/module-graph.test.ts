import { describe, expect, it } from "bun:test";
import { Context } from "effect";

import {
	EFFECT_MODULE_LAYERS,
	EffectContextOf,
	EffectGraphOf,
	createModuleContext,
	describeEffectModuleTree,
	effectModule,
	effectModuleTreeText,
	moduleLayers,
} from "../src/effect-graph";
import { HealthServiceModule } from "../src/demo/app.module";
import { HealthDomainModule } from "../src/demo/health.module";
import { HealthRegistryModule } from "../src/demo/health-registry.module";
import { HealthService } from "../src/demo/health.service";
import { AppLifecycleModule, PlainLifecycleModule } from "../src/demo/lifecycle.module";

class Correlation extends Context.Service<Correlation, { readonly id: string }>()(
	"request/Correlation",
) {}

describe("the tree", () => {
	it("shows every point, including the adapted opaque module", () => {
		const rows = describeEffectModuleTree(HealthServiceModule);

		expect(rows.map((row) => row.name)).toEqual([
			"HealthServiceModule",
			"HealthDomainModule",
			"HealthRegistryModule",
			"AppLifecycleModule.forRoot()",
		]);
		expect(rows[1]?.path).toBe("/HealthServiceModule/HealthDomainModule");
	});

	it("reports the token where it is registered, not where it is imported", () => {
		const registry = describeEffectModuleTree(HealthServiceModule).find(
			(row) => row.name === "HealthRegistryModule",
		);

		expect(registry?.provides).toEqual(["health/HealthRegistry"]);
	});

	it("counts the layers each module owns", () => {
		const domain = describeEffectModuleTree(HealthServiceModule).find(
			(row) => row.name === "HealthDomainModule",
		);

		expect(domain?.layers).toBe(1);
		expect(domain?.provides).toEqual([]);
	});

	it("renders as text", () => {
		expect(effectModuleTreeText(HealthServiceModule)).toContain("   layers:   1");
	});
});

describe("modules register their own layers", () => {
	it("puts the layer under the module, once", () => {
		const providers = Reflect.getMetadata("providers", HealthDomainModule) as Array<{
			readonly provide: unknown;
			readonly useValue?: unknown;
		}>;
		const entry = providers.find((provider) => provider.provide === EFFECT_MODULE_LAYERS);

		expect(entry?.useValue).toEqual([...moduleLayers(HealthDomainModule)]);
	});

	it("collects layers dependencies-first", () => {
		expect(moduleLayers(HealthServiceModule)).toEqual(moduleLayers(HealthDomainModule));
	});
});

describe("effectModule gives someone else's module a typed face", () => {
	it("accepts a true claim on a DynamicModule", () => {
		const wrapped = effectModule(AppLifecycleModule.forRoot(), []);

		expect(wrapped[EffectGraphOf].provides).toEqual([]);
	});

	it("accepts a true claim on a plain class", () => {
		const wrapped = effectModule(PlainLifecycleModule, []);

		expect(wrapped[EffectGraphOf].name).toBe("PlainLifecycleModule");
	});

	it("throws immediately on a claim the module does not honour", () => {
		expect(() => effectModule(AppLifecycleModule.forRoot(), [HealthService])).toThrow(
			/declares health\/HealthService but the module registers/,
		);
	});
});

describe("a module value carries both halves", () => {
	it("has a request context and a graph node", () => {
		expect(HealthDomainModule[EffectContextOf]).toBeDefined();
		expect(HealthRegistryModule[EffectGraphOf].provides).toEqual(["health/HealthRegistry"]);
	});

	it("keeps ambient keys out of what importers inherit", () => {
		const WithAmbient = createModuleContext({ name: "WithAmbient" }, Correlation);

		expect(WithAmbient[EffectGraphOf].ambient).toEqual(["request/Correlation"]);
		expect(WithAmbient[EffectGraphOf].provides).toEqual([]);
	});
});
