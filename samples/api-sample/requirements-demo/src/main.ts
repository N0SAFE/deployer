import "reflect-metadata";
import "@orpc/effect/extensions/effect";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { assertRequirementsMet, EffectRuntime } from "./effect";

/**
 * The strict check, before a single provider is built.
 *
 * `assertRequirementsMet` is a type gate, not a runtime probe: its parameter is `M & RequirementsMet<M>`, so passing a
 * module whose imports forward anything unresolved is a compile error naming the services. When everything is resolved
 * the call is the identity — there is no check to forget to run.
 */
const rootModule = assertRequirementsMet(AppModule);

const app = await NestFactory.create(rootModule);

// The migration report: what each controller reaches today that its module will not allow once the scope is enforced.
if (process.env.EFFECT_SCOPE_REPORT === "1") {
	const rows = app.get(EffectRuntime).scopeReport();
	for (const row of rows) console.log(`[scope] ${row.controller} → out of scope: ${row.outOfScope.join(", ")}`);
}

await app.listen(Number(process.env.PORT ?? 3100));

console.log("requirements demo → http://localhost:3100");
