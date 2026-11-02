import { Logger } from "@nestjs/common";
import { Effect } from "effect";

import type { DockerEngineShape } from "@deployer/docker";
import { splitManagedEnv } from "@deployer/env";
import {
	makeRedisSupervisor,
	PLATFORM_REDIS_SUPERVISOR_ID,
	
	
	type RedisSupervisor,
} from "@deployer/platform-supervisors";

import { EnvService } from "../../../../config/env/env.module";
import { buildSupervisor, type SupervisorEventBus, type SupervisorRegistration } from "../../supervision/index";

export { PLATFORM_REDIS_SUPERVISOR_ID };

export type RedisSupervisorDeps = {
	readonly engine: DockerEngineShape;
	readonly env: EnvService;
	readonly bus: SupervisorEventBus;
};

/**
 * The platform Redis supervisor. What it does (wire a compose-managed Redis to the overlay, or run one
 * replicated swarm service) is `@deployer/platform-supervisors`; this supplies the engine and the
 * environment, and always registers: managed links networks, swarm reconciles the service.
 */
export function makeRedisRegistration({ engine, env, bus }: RedisSupervisorDeps): {
	readonly registration: SupervisorRegistration;
	readonly redis: RedisSupervisor;
} {
	const logger = new Logger("RedisSupervisor");
	const redis = makeRedisSupervisor({
		engine,
		logger,
		config: {
			prefix: () => env.get("DEPLOYER_PREFIX") ?? "",
			image: () => env.get("DEPLOYER_REDIS_IMAGE"),
			password: () => env.get("DEPLOYER_REDIS_PASSWORD"),
			explicitUrl: () => env.get("DEPLOYER_REDIS_URL"),
			managed: () => splitManagedEnv(env).redis,
			runtimeOverride: () => process.env.SUPERVISOR_RUNTIME,
		},
	});
	return {
		redis,
		registration: {
			supervisor: buildSupervisor(redis.spec, bus, "RedisSupervisor"),
			activate: Effect.sync(() => {
				const { runtime, reason } = redis.resolveRuntime();
				logger.log(`Redis supervisor registering — runtime=${runtime} (${reason})`);
				return {};
			}),
		},
	};
}
