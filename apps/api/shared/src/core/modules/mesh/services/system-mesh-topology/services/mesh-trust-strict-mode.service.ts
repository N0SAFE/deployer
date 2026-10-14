import { Inject, Injectable } from "@nestjs/common";
import { isRecord } from "@repo/type-guards";
import { CLOCK_TOKEN, type Clock } from "../../../shared/primitives/clock";
  import { TokenBucket } from "../../../shared/primitives/token-bucket";
  import { MeshAuthorizationError, MeshValidationError } from "../domain/mesh-errors";
    import { SystemMeshConfigService } from "../../system-mesh-config.service";
    import { MeshTrustService } from "./mesh-trust.service";

  /**
   * Gestion du mode strict + readiness + rollout par vagues + auto-rollback
   * protégé par un token bucket pour empêcher les oscillations malveillantes.
   */
  @Injectable()
  export class MeshTrustStrictModeService {
      private requested = false;
      private readonly autoRollbackBudget: TokenBucket;

      constructor(
          @Inject(CLOCK_TOKEN) private readonly clock: Clock,
          private readonly trust: MeshTrustService,
          private readonly meshConfigService: SystemMeshConfigService,
      ) {
          // 3 rollbacks max, 1 token rechargé toutes les 10 minutes
          this.autoRollbackBudget = new TokenBucket(this.clock, 3, 1 / 600);
      }

      isPinnedFromEnv(): boolean {
          return this.meshConfigService.getControlEnvelopeTrustRequired()
      }

      isStrictConfigured(): boolean { return this.isPinnedFromEnv() || this.requested; }
      isRequested(): boolean { return this.requested; }
      setRequested(value: boolean): void { this.requested = value; }

      getReadiness(remoteNodeCount: number) {
          const conv = this.trust.getConvergence();
          const minRatio = this.resolveNumberConfig(
              "getTrustStrictMinAckRatio",
              "MESH_TRUST_STRICT_MIN_ACK_RATIO",
              1,
          );
          const maxAge = this.resolveNumberConfig(
              "getTrustStrictMaxAckAgeSeconds",
              "MESH_TRUST_STRICT_MAX_ACK_AGE_SECONDS",
              300,
          );
          const ackRatio = conv.expected > 0 ? conv.received / conv.expected : 1;
          const ageSeconds = this.rotationAgeSeconds(conv.lastRotatedAt);
          const hasActive = conv.activeKeyId !== null;
          const hasRemoteExpectation = conv.expected > 0 || remoteNodeCount === 0;
          const ratioOk = ackRatio >= minRatio;
          const sloBreached =
              conv.expected > 0 &&
              !ratioOk &&
              ageSeconds !== null &&
              ageSeconds > maxAge;

          const reasons: string[] = [];
          if (!conv.activeKeyId) reasons.push("missing_active_signing_key");
          if (!hasRemoteExpectation) reasons.push("no_remote_peers_observed");
          if (!ratioOk) reasons.push("insufficient_peer_ack_ratio");
          if (conv.expected > 0 && ageSeconds === null) reasons.push("rotation_not_observed_for_active_key");
          if (sloBreached) reasons.push("rotation_convergence_slo_breached");

          const rollbackTriggerSet = new Set([
              "missing_active_signing_key",
              "rotation_not_observed_for_active_key",
              "rotation_convergence_slo_breached",
          ]);
          const triggers = this.isStrictConfigured()
              ? reasons.filter((r) => rollbackTriggerSet.has(r))
              : [];

          return {
              ready: hasActive && hasRemoteExpectation && ratioOk && !sloBreached,
              strictConfigured: this.isStrictConfigured(),
              strictEnforced:
                  this.isStrictConfigured() &&
                  hasActive &&
                  hasRemoteExpectation &&
                  ratioOk &&
                  !sloBreached,
              activeKeyId: conv.activeKeyId,
              converged: conv.pending.length === 0,
              expectedAcks: conv.expected,
              receivedAcks: conv.received,
              pendingNodeIds: conv.pending,
              ackRatio,
              minAckRatio: minRatio,
              maxAckAgeSeconds: maxAge,
              lastRotationAgeSeconds: ageSeconds,
              rollbackRecommended: this.isStrictConfigured() && triggers.length > 0,
              rollbackTriggers: triggers,
              reasons,
          };
      }

      enable(setByRole: string | null | undefined, remoteNodeCount: number): void {
          this.assertSuperAdmin(setByRole, "enable strict mesh trust mode");
          const readiness = this.getReadiness(remoteNodeCount);
          if (!readiness.ready) {
              throw new MeshValidationError(
                  "Strict mesh trust mode cannot be enabled before readiness convergence",
              );
          }
          this.requested = true;
      }

      disable(setByRole: string | null | undefined): void {
          this.assertSuperAdmin(setByRole, "disable strict mesh trust mode");
          if (this.isPinnedFromEnv()) {
              throw new MeshValidationError(
                  "Strict mesh trust mode is pinned by environment and cannot be disabled at runtime",
              );
          }
          this.requested = false;
      }

      rollback(
          setByRole: string | null | undefined,
          force: boolean,
          remoteNodeCount: number,
      ): { rolledBack: boolean; triggers: string[] } {
          this.assertSuperAdmin(setByRole, "rollback strict mesh trust mode");
          if (this.isPinnedFromEnv()) {
              throw new MeshValidationError(
                  "Strict mesh trust mode is pinned by environment and cannot be rolled back at runtime",
              );
          }
          const r = this.getReadiness(remoteNodeCount);
          if (!force && !r.rollbackRecommended) {
              throw new MeshValidationError(
                  "Strict mesh trust rollback requires active rollback recommendation or force=true",
              );
          }
          const wasRequested = this.requested;
          this.requested = false;
          return { rolledBack: wasRequested, triggers: r.rollbackTriggers };
      }

      /**
       * Auto-rollback rate-limité via token bucket.
       * Empêche un attaquant de faire osciller le mode strict en spammant des envelopes.
       */
      maybeAutoRollback(remoteNodeCount: number): { triggered: boolean; reasons: string[] } {
          const autoEnabled =
              this.meshConfigService.getTrustStrictAutoRollback()

          if (!autoEnabled || !this.requested || this.isPinnedFromEnv()) {
              return { triggered: false, reasons: [] };
          }

          const r = this.getReadiness(remoteNodeCount);
          if (!r.rollbackRecommended) return { triggered: false, reasons: [] };

          if (!this.autoRollbackBudget.tryConsume()) {
              return { triggered: false, reasons: ["rate_limited_by_token_bucket"] };
          }

          this.requested = false;
          return { triggered: true, reasons: r.rollbackTriggers };
      }

      buildRolloutWaves(
          ackedNodeIds: string[],
          waveSize: number,
      ): { index: number; nodeIds: string[] }[] {
          const waves: { index: number; nodeIds: string[] }[] = [];
          for (let i = 0; i < ackedNodeIds.length; i += waveSize) {
              waves.push({
                  index: Math.floor(i / waveSize) + 1,
                  nodeIds: ackedNodeIds.slice(i, i + waveSize),
              });
          }
          return waves;
      }

      resolveWaveSize(explicit?: number): number {
          if (typeof explicit === "number" && Number.isFinite(explicit)) {
              return Math.max(1, Math.floor(explicit));
          }
          const cfg = this.meshConfigService.getTrustStrictRolloutWaveSize();
          if (typeof cfg === "number" && cfg >= 1) return cfg;
          const env = Number(process.env.MESH_TRUST_STRICT_ROLLOUT_WAVE_SIZE);
          return Number.isFinite(env) && env >= 1 ? env : 3;
      }

      private assertSuperAdmin(role: string | null | undefined, action: string): void {
          if (role !== "superAdmin" && role !== "superadmin") {
              throw new MeshAuthorizationError(action);
          }
      }

      private rotationAgeSeconds(iso: string | null): number | null {
          if (!iso) return null;
          const d = new Date(iso);
          if (Number.isNaN(d.getTime())) return null;
          return Math.max(0, Math.floor((this.clock.nowMs() - d.getTime()) / 1000));
      }

      private parseBoolEnv(name: string): boolean | null {
          const raw = process.env[name]?.trim().toLowerCase();
          if (raw === "true") return true;
          if (raw === "false") return false;
          return null;
      }

      private resolveNumberConfig(
          configMethod: string,
          envName: string,
          fallback: number,
      ): number {
          // IMPORTANT: invoke the config getter through `Function.prototype.call`
          // so the receiver (`this.meshConfigService`) is preserved. Detaching
          // the method (e.g. `cfg()`) makes `this` undefined inside the
          // config service, which crashes any call that touches
          // `this.ensureMeshConfig()`. See system-mesh-config.service.ts.
          const configService = isRecord(this.meshConfigService) ? this.meshConfigService : {};
          const cfg = configService[configMethod];
          const fromConfig = typeof cfg === "function"
              ? (cfg as (...args: unknown[]) => number | null | undefined).call(this.meshConfigService)
              : null;
          if (typeof fromConfig === "number" && Number.isFinite(fromConfig)) return fromConfig;
          const env = Number(process.env[envName]);
          return Number.isFinite(env) ? env : fallback;
      }
  }