import { Injectable } from "@nestjs/common";
import { AppError } from "@deployer/errors";
import {
    attachPostgresOverlay,
    buildPostgresSpec,
    makePostgresProvisioner,
    PostgresProvisionFailed,
    type PostgresIdentity,
} from "@deployer/docker";
import type { SwarmServiceSpecInput } from "@deployer/contracts-entities";
import { Cause, Effect, Exit } from "effect";
import type { PostgresIdentityConfig } from "../../docker-config";
import { DockerService } from "../../services/docker.service";

export function toPostgresIdentity(config: PostgresIdentityConfig): PostgresIdentity {
    return {
        databaseName: config.databaseName,
        username: config.username,
        password: config.password,
        image: config.image,
    };
}

/**
 * The Promise face of `PostgresProvisioner` (in `@deployer/docker`), for the Nest callers that are
 * not on Effect yet. A provisioning failure comes back as the `AppError` those callers match on.
 */
@Injectable()
export class PostgresServiceProvisioner {
    constructor(protected readonly dockerService: DockerService) {}

    private get provisioner() {
        return makePostgresProvisioner(this.dockerService.getEngine());
    }

    private async run<A>(effect: Effect.Effect<A, unknown>): Promise<A> {
        const exit = await Effect.runPromiseExit(effect);
        if (Exit.isSuccess(exit)) {
            return exit.value;
        }
        const failure = Cause.squash(exit.cause);
        if (failure instanceof PostgresProvisionFailed) {
            throw new AppError(failure.message, "POSTGRES_PROVISION_FAILED", {});
        }
        throw failure;
    }

    buildSpec(input: { prefix?: string | null; identity: PostgresIdentity }): SwarmServiceSpecInput {
        return buildPostgresSpec(input);
    }

    attachOverlay(spec: SwarmServiceSpecInput, prefix?: string | null): SwarmServiceSpecInput {
        return attachPostgresOverlay(spec, prefix);
    }

    ensureOverlay(prefix?: string | null): Promise<string> {
        return this.run(this.provisioner.ensureOverlay(prefix));
    }

    ensure(input: {
        prefix?: string | null;
        identity: PostgresIdentity;
        waitAttempts?: number;
        waitIntervalMs?: number;
    }): Promise<SwarmServiceSpecInput> {
        return this.run(this.provisioner.ensure(input));
    }

    remove(prefix?: string | null): Promise<void> {
        return this.run(this.provisioner.remove(prefix));
    }
}
