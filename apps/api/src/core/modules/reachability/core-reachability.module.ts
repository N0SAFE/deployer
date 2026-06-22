import { Module } from '@nestjs/common';
import { ReachabilityService } from './services/reachability.service';

/**
 * Provides {@link ReachabilityService} for setup-time pre-flight probes.
 *
 * The service is consumed by:
 *   - `InitializationService` (server-side `reachability_check` step in
 *     the remote setup flow).
 *   - `SetupController.probeMesh` (handles `POST /setup/probe/mesh`,
 *     called by the remote setup wizard via `setupContract.probeMesh`).
 *
 * There is no HTTP controller here on purpose — the wizard reaches the
 * service through the ORPC-backed `setupContract.probeMesh` route in
 * `SetupController`. A previous REST controller at
 * `/reachability/check` was removed when it became a duplicate of the
 * setup controller's logic.
 */
@Module({
  providers: [ReachabilityService],
  exports: [ReachabilityService],
})
export class CoreReachabilityModule {}
