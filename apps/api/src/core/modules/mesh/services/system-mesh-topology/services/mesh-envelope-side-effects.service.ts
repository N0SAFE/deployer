import { Injectable } from "@nestjs/common";
  import {
      meshNodeStateSchema,
      meshPeerConnectionSchema,
      meshMembershipSnapshotSchema,
      meshQueueTransitionLogEntrySchema,
      type MeshControlEnvelope,
  } from "@repo/contracts-entities";
  import { MeshMembershipService } from "./mesh-membership.service";
  import { MeshHealthMonitorService } from "./mesh-health-monitor.service";
  import { MeshTrustService } from "./mesh-trust.service";
  import { MeshTrustStrictModeService } from "./mesh-trust-strict-mode.service";
  import { MeshQueueReplicationService } from "./mesh-queue-replication.service";
  import { MeshControlPlaneService } from "./mesh-control-plane.service";
  import { MeshIdentityService } from "./mesh-identity.service";
  import { SystemMeshLogicService } from "../../system-mesh-logic.service";

  /**
   * Applique les effets de bord de chaque type d'envelope de contrôle.
   * Extrait du God Service pour être testable isolément.
   */
  @Injectable()

/**
 * Type guard that narrows `unknown` to a record-like object so we can
 * index it with string keys. Used in place of `as Record<string, unknown>`
 * to avoid the runtime lie.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
  export class MeshEnvelopeSideEffectsService {
      constructor(
          private readonly identity: MeshIdentityService,
          private readonly membership: MeshMembershipService,
          private readonly health: MeshHealthMonitorService,
          private readonly trust: MeshTrustService,
          private readonly strictMode: MeshTrustStrictModeService,
          private readonly queueReplication: MeshQueueReplicationService,
          private readonly controlPlane: MeshControlPlaneService,
          private readonly meshLogic: SystemMeshLogicService,
      ) {}

      apply(envelope: MeshControlEnvelope): void {
          switch (envelope.type) {
              case "hello": {this.onHello(envelope); return;};
              case "heartbeat": {this.onHeartbeat(envelope); return;};
              case "membership_suspect": {this.onMembershipSuspect(envelope); return;};
              case "membership_confirm": {this.onMembershipConfirm(envelope); return;};
              case "membership_remove": {this.onMembershipRemove(envelope); return;};
              case "anti_entropy_sync": {this.onAntiEntropySync(envelope); return;};
              case "topology_delta": {this.onTopologyDelta(envelope); return;};
              case "queue_transition": {this.onQueueTransition(envelope); return;};
              case "trust_keyring_sync": {this.onTrustKeyringSync(envelope); return;};
              case "trust_keyring_ack": {this.onTrustKeyringAck(envelope); return;};
              case "trust_strict_mode_sync": {this.onTrustStrictModeSync(envelope); return;};
              default: break;
          }
      }

      private onHello(envelope: MeshControlEnvelope): void {
          const parsed = meshNodeStateSchema.safeParse(envelope.payload.node);
          if (!parsed.success) return;
          const node = { ...parsed.data, lastSeenAt: new Date().toISOString() };
          this.membership.upsertRemoteNode(node);
      }

      private onHeartbeat(envelope: MeshControlEnvelope): void {
          const source = this.membership.getRemoteNode(envelope.sourceNodeId);
          if (!source) {
              const parsed = meshNodeStateSchema.safeParse(envelope.payload.node);
              if (parsed.success) this.membership.upsertRemoteNode(parsed.data);
              return;
          }
          this.membership.upsertRemoteNode({
              ...source,
              lifecycleState: "healthy",
              lastSeenAt: new Date().toISOString(),
          });
      }

      private onMembershipSuspect(envelope: MeshControlEnvelope): void {
          const nodeId = this.extractNodeId(envelope);
          if (nodeId) this.membership.markSuspect(nodeId);
      }

      private onMembershipConfirm(envelope: MeshControlEnvelope): void {
          const nodeId = this.extractNodeId(envelope);
          if (nodeId) this.membership.markIsolated(nodeId);
      }

      private onMembershipRemove(envelope: MeshControlEnvelope): void {
          const nodeId = this.extractNodeId(envelope);
          if (!nodeId) return;
          this.membership.removeRemoteNode(nodeId);
          // removeRemoteNode déclenche déjà removeByNodeId sur health + sessions
      }

      private onAntiEntropySync(envelope: MeshControlEnvelope): void {
          const parsed = meshMembershipSnapshotSchema.safeParse(envelope.payload.snapshot);
          if (!parsed.success) return;
          this.membership.reconcile({
              snapshot: parsed.data,
              sourceNodeId: envelope.sourceNodeId,
              dryRun: false,
          });
      }

      private onTopologyDelta(envelope: MeshControlEnvelope): void {
          const parsed = meshPeerConnectionSchema.safeParse(envelope.payload.edge);
          if (!parsed.success) return;
          const metrics = this.meshLogic.computeWeightedMetrics(parsed.data.metrics);
          this.health.upsertFromReconcile({ ...parsed.data, metrics, activePathRank: 1 });
          this.health.recomputeRanks();
      }

      private onQueueTransition(envelope: MeshControlEnvelope): void {
          const parsed = meshQueueTransitionLogEntrySchema.safeParse(envelope.payload.entry);
          if (!parsed.success) return;
          this.queueReplication.applyReplicated({
              entry: {
                  ...parsed.data,
                  organizationId: envelope.organizationId ?? parsed.data.organizationId ?? null,
              },
          });
      }

      private onTrustKeyringSync(envelope: MeshControlEnvelope): void {
          const raw = envelope.payload.keys;
          const activeKeyId = envelope.payload.activeKeyId;
          if (!Array.isArray(raw)) return;

          const keys: { keyId: string; algorithm: "HS256"; secret: string; status: "active" | "previous" }[] = [];
          for (const item of raw) {
              if (!item || typeof item !== "object") continue;
              const v = item as Record<string, unknown>;
              if (
                  typeof v.keyId === "string" && v.keyId.length > 0 &&
                  v.algorithm === "HS256" &&
                  typeof v.secretMaterial === "string" && v.secretMaterial.length > 0 &&
                  (v.status === "active" || v.status === "previous")
              ) {
                  keys.push({ keyId: v.keyId, algorithm: "HS256", secret: v.secretMaterial, status: v.status });
              }
          }
          if (keys.length === 0) return;

          this.trust.applySnapshot({
              activeKeyId: typeof activeKeyId === "string" && activeKeyId.length > 0 ? activeKeyId : null,
              keys,
          });

          // ACK en retour si le message vient d'un pair
          if (envelope.sourceNodeId === this.identity.getNodeId()) return;
          const ackKeyId = typeof activeKeyId === "string" && activeKeyId.length > 0
              ? activeKeyId
              : this.trust.getActiveKeyId();
          if (!ackKeyId) return;

          this.controlPlane.publish({
              envelopeId: crypto.randomUUID(),
              type: "trust_keyring_ack",
              sourceNodeId: this.identity.getNodeId(),
              targetNodeId: envelope.sourceNodeId,
              hop: 0,
              maxHops: 16,
              emittedAt: new Date().toISOString(),
              payload: { keyId: ackKeyId, ackedAt: new Date().toISOString() },
          });
      }

      private onTrustKeyringAck(envelope: MeshControlEnvelope): void {
          const keyId = envelope.payload.keyId;
          if (typeof keyId !== "string" || keyId.length === 0) return;
          this.trust.recordAck(keyId, envelope.sourceNodeId);
      }

      private onTrustStrictModeSync(envelope: MeshControlEnvelope): void {
          const enabled = envelope.payload.enabled;
          if (typeof enabled !== "boolean") return;
          if (!enabled && this.strictMode.isPinnedFromEnv()) return;
          this.strictMode.setRequested(enabled);
      }

      private extractNodeId(envelope: MeshControlEnvelope): string | null {
          const v = envelope.payload.nodeId;
          return typeof v === "string" && v.length > 0 ? v : null;
      }
  }