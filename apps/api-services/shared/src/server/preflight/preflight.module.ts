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
