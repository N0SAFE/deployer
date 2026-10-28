import { Injectable, Inject } from "@nestjs/common";
import { splitManagedEnv } from "@deployer/env";
import { SupervisorHost } from "../../supervision/index";
import { DockerEngine, type DockerEngineShape } from "@deployer/docker";
import {
	makeRedisSupervisor,
	PLATFORM_REDIS_SUPERVISOR_ID,
	redisProcessInfoSchema,
	redisSupervisorPayloadSchema,
	type RedisSupervisor,
} from "@deployer/platform-supervisors";

import { EnvService } from "../../../../config/env/env.module";

export { PLATFORM_REDIS_SUPERVISOR_ID };

/**
 * The Nest host of the platform Redis supervisor. What it does (wire a compose-managed Redis to the
 * overlay, or run one replicated swarm service) is `@deployer/platform-supervisors`; this class
 * supplies the engine and the environment, and exposes the typed connection URL consumers inject.
 */
@Injectable()
export class RedisSupervisorService extends SupervisorHost<
	typeof redisSupervisorPayloadSchema,
	typeof redisProcessInfoSchema
> {
	static readonly identifier = PLATFORM_REDIS_SUPERVISOR_ID;

	readonly payloadSchema = redisSupervisorPayloadSchema;
	readonly processInfoSchema = redisProcessInfoSchema;
	readonly description: string;

	private readonly redis: RedisSupervisor;

	constructor(@Inject(DockerEngine) dockerService: DockerEngineShape, env: EnvService) {
		super();
		this.redis = makeRedisSupervisor({
			engine: dockerService,
			logger: this.logger,
			config: {
				prefix: () => env.get("DEPLOYER_PREFIX") ?? "",
				image: () => env.get("DEPLOYER_REDIS_IMAGE"),
				password: () => env.get("DEPLOYER_REDIS_PASSWORD"),
				explicitUrl: () => env.get("DEPLOYER_REDIS_URL"),
				managed: () => splitManagedEnv(env).redis,
				runtimeOverride: () => process.env.SUPERVISOR_RUNTIME,
			},
		});
		this.description = this.redis.spec.description;
	}

	protected buildSpec(): RedisSupervisor["spec"] {
		return this.redis.spec;
	}

	/** The typed connection URL consumers use to reach Redis. */
	getConnectionUrl(): string {
		return this.redis.connectionUrl();
	}

	/** Always register: managed links networks, swarm reconciles the service. */
	override onModuleInit(): void {
		const { runtime, reason } = this.redis.resolveRuntime();
		this.logger.log(`Redis supervisor registering — runtime=${runtime} (${reason})`);
		super.onModuleInit();
	}
}
