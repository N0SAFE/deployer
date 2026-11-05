import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";

import { authAuditEvents } from "@deployer/nest-schema/global/identity/audit";

import { DatabasePort, type DatabaseShape } from "@identity/core/database/database.port";
import { setDenialSink } from "@identity/core/orpc/denial";

/**
 * Records every refusal an authorized caller received (`SEC-068`).
 *
 * The producer is the request boundary, which knows the actor and the correlation id; this provider only gives
 * it a destination. Fire-and-forget, like the auth-side sink: a failed audit write must not turn a 403 into a 500.
 */
@Injectable()
export class DenialAuditInstaller implements OnApplicationBootstrap {
	private readonly logger = new Logger(DenialAuditInstaller.name);

	constructor(@Inject(DatabasePort) private readonly database: DatabaseShape) {}

	onApplicationBootstrap(): void {
		setDenialSink((event) => {
			void this.database.db
				.insert(authAuditEvents)
				.values({
					action: event.action,
					actorId: event.actorId ?? null,
					ip: event.ip ?? null,
					userAgent: event.userAgent ?? null,
					detail: event.detail,
				})
				.catch((error: unknown) => {
					this.logger.warn(`denial audit write failed: ${String(error)}`);
				});
		});
	}
}
