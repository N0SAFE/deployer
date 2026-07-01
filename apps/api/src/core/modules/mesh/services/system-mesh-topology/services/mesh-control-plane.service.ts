import { Inject, Injectable, Logger } from "@nestjs/common";
  import type { MeshControlEnvelope } from "@repo/contracts-entities";
  import { CLOCK_TOKEN, type Clock } from "../../../shared/primitives/clock";
  import { TokenBucket } from "../../../shared/primitives/token-bucket";
  import { MeshTrustError } from "../domain/mesh-errors";
    import { MeshTrustService } from "./mesh-trust.service";
    import { MeshTrustStrictModeService } from "./mesh-trust-strict-mode.service";
    import { MeshIdentityService } from "./mesh-identity.service";
    import { MeshHealthMonitorService } from "./mesh-health-monitor.service";
    import { SystemMeshOverlayScopeService } from "../../system-mesh-overlay-scope.service";
    import { SystemMeshEventService } from "../../../events/system-mesh-event.service";

  /**
   * Routing, signature et dispatch des control envelopes.
   * Rate-limité par token bucket pour résister aux abus.
   */
  @Injectable()
  export class MeshControlPlaneService {
      private readonly logger = new Logger(MeshControlPlaneService.name);
      private readonly handlers = new Set<(envelope: MeshControlEnvelope) => void>();
      private readonly publishBudget: TokenBucket;

      constructor(
          @Inject(CLOCK_TOKEN) private readonly clock: Clock,
          private readonly identity: MeshIdentityService,
          private readonly trust: MeshTrustService,
          private readonly strictMode: MeshTrustStrictModeService,
          private readonly health: MeshHealthMonitorService,
          private readonly overlayScope: SystemMeshOverlayScopeService,
          private readonly meshEventService: SystemMeshEventService,
      ) {
          // 5000 envelopes max en burst, refill 2000/s.
          //
          // The original 500/200 budget was too tight for legitimate
          // high-volume publishers like the docker runtime event stream
          // (which can emit hundreds of `event_publish` envelopes per
          // second during container churn). Bumping the budget to 5000
          // burst / 2000/s refill makes the `Control envelope rate
          // limit exceeded` warning a true abuse signal instead of
          // tripping on normal activity. The single-node fast path in
          // `MeshTopicPublisherService` still avoids wasting tokens on
          // self-only emissions.
          this.publishBudget = new TokenBucket(this.clock, 5000, 2000);
      }

      publish(envelope: MeshControlEnvelope): {
          accepted: boolean;
          envelopeId: string;
          forwardedTo: string[];
      } {
          if (!this.publishBudget.tryConsume()) {
              this.logger.warn(
                  `Control envelope rate limit exceeded — type=${envelope.type} source=${envelope.sourceNodeId}`,
              );
              return { accepted: false, envelopeId: envelope.envelopeId, forwardedTo: [] };
          }

          const trusted = this.ensureTrusted(envelope);
          this.notifyHandlers(trusted);

          const candidates = trusted.targetNodeId
              ? [trusted.targetNodeId]
              : this.health
                    .listRanked()
                    .filter((c) => c.state !== "down")
                    .map((c) => c.targetNodeId);

          const forwardedTo = this.overlayScope.filterForwardedNodeIdsByOrganization(
              candidates,
              trusted.organizationId ?? null,
          );

          return { accepted: true, envelopeId: trusted.envelopeId, forwardedTo };
      }

      registerHandler(handler: (envelope: MeshControlEnvelope) => void): () => void {
          this.handlers.add(handler);
          return () => {
              this.handlers.delete(handler);
          };
      }

      /**
       * Applique le scope organisation de la session sur l'envelope.
       * Retourne null si l'envelope tente de sortir de son scope.
       */
      applySessionScope(
          envelope: MeshControlEnvelope,
          sessionOrganizationId: string | null,
      ): MeshControlEnvelope | null {
          if (!sessionOrganizationId) return envelope;
          if (envelope.organizationId && envelope.organizationId !== sessionOrganizationId) {
              return null;
          }
          return { ...envelope, organizationId: sessionOrganizationId };
      }

      private ensureTrusted(envelope: MeshControlEnvelope): MeshControlEnvelope {
          if (!this.trust.hasKeys()) return envelope;

          const isLocal = envelope.sourceNodeId === this.identity.getNodeId();
          const strictEnforced =
              this.strictMode.isStrictConfigured() &&
              this.strictMode.getReadiness(0).ready;

          if (isLocal) {
              // Déjà signé par ce nœud → vérifie seulement
              if (envelope.signature && envelope.keyId) {
                  this.trust.verify(envelope);
                  return envelope;
              }
              // Signe à la volée
              return this.trust.sign(envelope);
          }

          // Nœud distant
          if (!envelope.signature || !envelope.keyId) {
              if (!strictEnforced) return envelope;
              throw new MeshTrustError("signed_envelope_required_for_remote_node");
          }

          this.trust.verify(envelope);
          return envelope;
      }

      private notifyHandlers(envelope: MeshControlEnvelope): void {
          for (const handler of this.handlers) {
              try {
                  handler(envelope);
              } catch (error) {
                  // On log l'erreur mais on ne laisse jamais un handler externe
                  // interrompre le plan de contrôle.
                  this.logger.error(
                      `Control envelope handler threw — type=${envelope.type} error=${
                          error instanceof Error ? error.message : String(error)
                      }`,
                  );
              }
          }
      }
  }