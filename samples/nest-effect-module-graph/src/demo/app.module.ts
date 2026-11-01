import { createModuleContext } from "../effect-graph";
import { effectModule } from "../effect-graph";
import { HealthDomainModule } from "./health.module";
import { AppLifecycle, AppLifecycleModule } from "./lifecycle.module";

/**
 * The root: imports only, no providers, no layer list.
 *
 * It closes because `HealthDomainModule` already closed. The lifecycle is a
 * module we do not own, so it is given a typed face at the import site — the
 * one place where a claim about someone else's providers is made, and it is
 * verified against that module's metadata immediately.
 */
export class HealthServiceModule extends createModuleContext({
	name: "HealthServiceModule",
	imports: [HealthDomainModule, effectModule(AppLifecycleModule.forRoot(), [AppLifecycle])],
}) {}
