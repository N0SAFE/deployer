import { Module } from "@nestjs/common";
import type { DynamicModule } from "@nestjs/common";

import { WAIT_FOR_DEPENDENCIES, type PreflightPolicy } from "./runner";
import {
	PREFLIGHT_DEPENDENCIES,
	PREFLIGHT_POLICY,
	PreflightService,
} from "./preflight.service";
import { SERVICE_READINESS } from "../service-health";
import type { PreflightDependency } from "./types";

/**
 * Wires dependency preflight for one app.
 *
 * `forRoot` takes the dependency set because it is a property of the APP, not of
 * the framework: the BFF needs the database and Redis, a pure compute service
 * needs nothing, and only the app's author knows which. Declaring it here means
 * a service that forgets to require the database is a visible omission rather
 * than a silent one that fails its first request.
 *
 * Binds `SERVICE_READINESS` to the preflight verdict, so `/health/ready` and the
 * boot gate are the SAME answer by construction — they cannot disagree.
 */
@Module({})
export class PreflightModule {
	static forRoot(options: {
		readonly dependencies: readonly PreflightDependency[];
		/**
		 * Omit to WAIT for dependencies (a boot). Pass `REPORT_ONLY` when the caller
		 * wants an immediate answer and will act on the report itself.
		 */
		readonly policy?: PreflightPolicy;
	}): DynamicModule {
		return {
			module: PreflightModule,
			// ── GLOBAL, BECAUSE THE READINESS PORT MUST BE VISIBLE EVERYWHERE ────
			// The comment below has always claimed that "`SERVICE_READINESS` and
			// `/health/ready` cannot disagree by construction". They could, and did,
			// because `exports` only reaches modules that IMPORT this one — and
			// `ServiceHealthModule` — the module that owns the `/health/ready`
			// ROUTE — declares the controller without importing `PreflightModule`.
			//
			// Inside that module `SERVICE_READINESS` was therefore unresolvable.
			// `@Optional()` turned that into a silent `null`, and the controller's
			// `?? true` fallback then answered **ready** forever. Measured on a
			// stack whose database had never been migrated:
			//
			//   [preflight] preflight attempt 317 not ready — retrying in 2000ms
			//   GET /health/ready -> 200 {"status":"ready"}
			//   docker ps         -> Up (healthy)
			//
			// So compose marked five services healthy while every one of them was
			// still refusing to serve, and `bff` started on top of them. The
			// dependency retry loop was invisible to the orchestrator precisely
			// because the endpoint meant to report it could not see the verdict.
			//
			// `global: true` is the right fix rather than adding an import to every
			// health module: there are six apps and one controller, the port is a
			// platform-wide concern, and the failure mode of a missing import is
			// SILENT (a green probe), not a boot error. `useExisting` still keeps
			// ONE instance, so the route and the boot gate read the same verdict.
			global: true,
			providers: [
				{ provide: PREFLIGHT_DEPENDENCIES, useValue: options.dependencies },
				{ provide: PREFLIGHT_POLICY, useValue: options.policy ?? WAIT_FOR_DEPENDENCIES },
				PreflightService,
				// The readiness port IS the preflight verdict. `useExisting` keeps ONE
				// instance, so `/health/ready` cannot report a stale answer from a
				// second copy that never ran the checks.
				{ provide: SERVICE_READINESS, useExisting: PreflightService },
			],
			exports: [PreflightService, SERVICE_READINESS],
		};
	}
}
