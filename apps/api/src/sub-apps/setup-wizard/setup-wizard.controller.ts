import { Controller } from '@nestjs/common';
import { Implement, implement } from '@orpc/nest';
import { ORPCError } from '@orpc/server';
import { setupContract } from '@repo/api-contracts';
import { Pool } from 'pg';
import { InitializationService } from '@/core/modules/setup/services/initialization.service';
import { ReachabilityService } from '@/core/modules/reachability/services/reachability.service';

@Controller()
export class SetupWizardController {
  constructor(
    private readonly initializationService: InitializationService,
    private readonly reachabilityService: ReachabilityService,
  ) {}

  @Implement(setupContract.getState)
  getState() {
    return implement(setupContract.getState)
      .handler(() => this.initializationService.getSetupState());
  }

  @Implement(setupContract.getNodeStatus)
  getNodeStatus() {
    return implement(setupContract.getNodeStatus)
      .handler(() => this.initializationService.getNodeStatus());
  }

  @Implement(setupContract.probeDatabase)
  probeDatabase() {
    return implement(setupContract.probeDatabase)
      .handler(async ({ input }) => {
        const start = Date.now();
        const pool = new Pool({
          connectionString: input.databaseUrl.trim(),
          max: 1,
          connectionTimeoutMillis: 5_000,
        });
        try {
          await pool.query('SELECT 1');
          return {
            status: 201, headers: {},
            body: { reachable: true, latencyMs: Date.now() - start },
          };
        } catch (err: unknown) {
          return {
            status: 201, headers: {},
            body: { reachable: false, error: err instanceof Error ? err.message : String(err) },
          };
        } finally {
          await pool.end().catch(() => undefined);
        }
      });
  }

  @Implement(setupContract.probeMesh)
  probeMesh() {
    return implement(setupContract.probeMesh)
      .handler(async ({ input }) => {
        const result = await this.reachabilityService.checkMeshUrlReachability(input.meshUrl);
        return {
          status: 201, headers: {},
          body: {
            reachable: result.reachable, latencyMs: result.latencyMs,
            advertisedHost: result.advertisedHost, version: result.version,
            error: result.reachable ? undefined : result.error,
          },
        };
      });
  }

  @Implement(setupContract.triggerInitialize)
  triggerInit() {
    return implement(setupContract.triggerInitialize)
      .handler(async ({ input }) => {
        const result = this.initializationService.triggerInitialize(input);
        if (!result.accepted) {
          throw new ORPCError('CONFLICT', { message: 'Initialization already in progress' });
        }
        return { accepted: true };
      });
  }

  @Implement(setupContract.getInitializeStream)
  stream() {
    return implement(setupContract.getInitializeStream)
      .handler(() => {
        return this.initializationService.getInitializeStream();
      });
  }
}
