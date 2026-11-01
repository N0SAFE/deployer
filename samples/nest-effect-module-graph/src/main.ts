import { Context } from "effect";

import {
	createModuleContext,
	describeEffectModuleTree,
	effectModuleTreeText,
	moduleLayers,
} from "./effect-graph";
import { HealthServiceModule } from "./demo/app.module";
import { HealthDomainModule } from "./demo/health.module";

console.log("── the module tree ───────────────────────────────────────────────\n");
console.log(effectModuleTreeText(HealthServiceModule));

console.log("\n── per node ──────────────────────────────────────────────────────");
for (const row of describeEffectModuleTree(HealthServiceModule)) {
	console.log(
		`${row.path}\n  provides: ${row.provides.join(", ") || "—"}\n  layers:   ${row.layers}\n  ambient:  ${row.ambient.join(", ") || "—"}${row.opaque ? "\n  opaque:   yes" : ""}`,
	);
}

console.log("\n── layers the runtime has to build (tree order) ──────────────────");
console.log(moduleLayers(HealthServiceModule).length, "layer(s) collected from the modules");

// A service that exists only inside a request: visible here, importable
// nowhere, and never a substitute for importing the module that provides a
// module-level requirement.
class Correlation extends Context.Service<Correlation, { readonly id: string }>()(
	"request/Correlation",
) {}

const WithAmbient = createModuleContext({ name: "WithAmbient" }, Correlation);

console.log("\n── ambient is local to the module ────────────────────────────────");
console.log(describeEffectModuleTree(WithAmbient)[0]);
