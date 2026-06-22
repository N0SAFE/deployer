import { Inject, Injectable } from "@nestjs/common";
  import { createHash } from "node:crypto";
  import {
      meshQueueTransitionLogEntrySchema,
      type MeshQueuePartitionPlanInput,
      type MeshQueuePartitionPlanResult,
      type MeshQueueTransitionAppendInput,
      type MeshQueueTransitionAppendResult,
      type MeshQueueTransitionApplyInput,
      type MeshQueueTransitionApplyResult,
      type MeshQueueTransitionListInput,
      type MeshQueueTransitionListResult,
      type MeshQueueTransitionLogEntry,
      type MeshQueueTransitionPayload,
      type MeshNodeRole,
  } from "@repo/contracts-entities";
  import { CLOCK_TOKEN, type Clock } from "../../../shared/primitives/clock";
  import { ID_GENERATOR_TOKEN, type IdGenerator } from "../../../shared/primitives/id-generator";
  import { BoundedEventLog } from "../../../shared/primitives/bounded-event-log";
  import { SlidingDedupWindow } from "../../../shared/primitives/sliding-dedup-window";
  import { FencingTokenIssuer } from "../../../shared/primitives/fencing-token";
    import { MeshIdentityService } from "./mesh-identity.service";
    import { MeshMembershipService } from "./mesh-membership.service";
    import { SystemMeshOverlayScopeService } from "../../system-mesh-overlay-scope.service";
    import { SystemMeshLogicService } from "../../system-mesh-logic.service";
    import { MeshHealthMonitorService } from "./mesh-health-monitor.service";

  interface QueuePartitionCandidate {
      nodeId: string;
      ownerServerUrl: string | null;
      role: MeshNodeRole;
      local: boolean;
  }

  /**
   * Queue partition ownership (rendezvous hash) + transition log borné.
   *
   * Primitives utilisées :
   *  - BoundedEventLog : log append-only avec compaction automatique
   *  - SlidingDedupWindow : déduplication idempotente bornée en mémoire
   *  - FencingTokenIssuer : évite le split-brain sur les leases
   */
  @Injectable()
  export class MeshQueueReplicationService {
      private readonly log: BoundedEventLog<MeshQueueTransitionLogEntry>;
      private readonly dedupByIdempotency: SlidingDedupWindow;
      private readonly dedupByTransitionId: SlidingDedupWindow;
      private readonly sequenceByNode = new Map<string, number>();
      private readonly fencing = new FencingTokenIssuer();

      constructor(
          @Inject(CLOCK_TOKEN) private readonly clock: Clock,
          @Inject(ID_GENERATOR_TOKEN) private readonly idGen: IdGenerator,
          private readonly identity: MeshIdentityService,
          private readonly membership: MeshMembershipService,
          private readonly health: MeshHealthMonitorService,
          private readonly overlayScope: SystemMeshOverlayScopeService,
          private readonly meshLogic: SystemMeshLogicService,
      ) {
          this.log = new BoundedEventLog(10_000, 24 * 60 * 60 * 1000);
          this.dedupByIdempotency = new SlidingDedupWindow(this.clock, 24 * 60 * 60 * 1000, 100_000);
          this.dedupByTransitionId = new SlidingDedupWindow(this.clock, 24 * 60 * 60 * 1000, 100_000);
      }

      append(input: MeshQueueTransitionAppendInput): MeshQueueTransitionAppendResult {
          const now = this.clock.nowIso();
          const sourceNodeId = this.identity.getNodeId();
          const nextSeq = (this.sequenceByNode.get(sourceNodeId) ?? 0) + 1;

          if (!this.dedupByIdempotency.checkAndRecord(input.idempotencyKey)) {
              const entry = this.findByIdempotency(input.idempotencyKey);
              if (!entry) {
                    throw new Error("Inconsistent deduplication state: idempotency key marked as seen but entry not found");
                }
              return { appended: false, duplicate: true, reason: "duplicate_delivery", entry: entry };
          }

          const payload: MeshQueueTransitionPayload = {
              transitionId: this.idGen.uuid(),
              queue: input.queue,
              partitionKey: input.partitionKey,
              jobId: input.jobId ?? null,
              fromStatus: input.fromStatus ?? null,
              toStatus: input.toStatus,
              workerId: input.workerId ?? null,
              idempotencyKey: input.idempotencyKey,
              occurredAt: input.occurredAt ?? now,
              metadata: input.metadata ?? null,
          };

          const entry: MeshQueueTransitionLogEntry = {
              organizationId: input.organizationId ?? null,
              sourceNodeId,
              sequence: nextSeq,
              payloadHash: this.hashPayload(payload),
              payload,
              receivedAt: now,
          };

          const transitionKey = `${sourceNodeId}:${payload.transitionId}`;
          this.dedupByTransitionId.checkAndRecord(transitionKey);
          this.log.append(entry, this.clock.nowMs());
          this.sequenceByNode.set(sourceNodeId, nextSeq);

          return { appended: true, duplicate: false, reason: null, entry };
      }

      applyReplicated(input: MeshQueueTransitionApplyInput): MeshQueueTransitionApplyResult {
          const parsed = meshQueueTransitionLogEntrySchema.parse(input.entry);

          if (!this.dedupByIdempotency.checkAndRecord(parsed.payload.idempotencyKey)) {
              const existing = this.findByIdempotency(parsed.payload.idempotencyKey);
              if (!existing) {
                    throw new Error("Inconsistent deduplication state: idempotency key marked as seen but entry not found");
                }
              return { applied: false, duplicate: true, reason: "duplicate_delivery", entry: existing };
          }

          const transitionKey = `${parsed.sourceNodeId}:${parsed.payload.transitionId}`;
          if (!this.dedupByTransitionId.checkAndRecord(transitionKey)) {
              const existing = this.findByIdempotency(parsed.payload.idempotencyKey);
              return { applied: false, duplicate: true, reason: "duplicate_transition", entry: existing ?? parsed };
          }

          this.log.append(parsed, this.clock.nowMs());
          const current = this.sequenceByNode.get(parsed.sourceNodeId) ?? 0;
          if (parsed.sequence > current) this.sequenceByNode.set(parsed.sourceNodeId, parsed.sequence);

          return { applied: true, duplicate: false, reason: null, entry: parsed };
      }

      list(input: MeshQueueTransitionListInput): MeshQueueTransitionListResult {
          const afterSeq = input.fromSequence ?? 0;
          const raw = this.log.readFrom(afterSeq - 1, (input.limit) + 1);
          const filtered = raw
              .map((e) => e.payload)
              .filter((e) => !input.organizationId || (e.organizationId ?? null) === input.organizationId)
              .filter((e) => !input.queue || e.payload.queue === input.queue)
              .filter((e) => !input.partitionKey || e.payload.partitionKey === input.partitionKey)
              .filter((e) => !input.sourceNodeId || e.sourceNodeId === input.sourceNodeId);

          const items = filtered.slice(0, input.limit);
          const hasMore = filtered.length > items.length;
          return {
              items,
              total: filtered.length,
              nextFromSequence: hasMore ? (items.at(-1)?.sequence ?? null) : null,
          };
      }

      planPartitionOwnership(input: MeshQueuePartitionPlanInput): MeshQueuePartitionPlanResult {
          const nowIso = this.clock.nowIso();
          const orgId = input.organizationId ?? null;
          const candidates = this.buildCandidates(orgId);

          const ranked = candidates
              .map((c) => ({
                  ...c,
                  score: this.rendezvousScore(input.queue, input.partitionKey, c.nodeId),
              }))
              .sort((a, b) => b.score !== a.score ? b.score - a.score : a.nodeId.localeCompare(b.nodeId));

          const selected = ranked[0];
          const localNodeId = this.identity.getNodeId();

          if (!selected) {
              return {
                  queue: input.queue, partitionKey: input.partitionKey,
                  ownerNodeId: localNodeId,
                  ownerServerUrl: this.resolveServerUrl(localNodeId),
                  forwardingRequired: false, forwardedToNodeId: null,
                  leaseHandoff: false, selectedAt: nowIso, candidates: [],
              };
          }

          const leaseActive = input.leaseExpiresAt ? input.leaseExpiresAt > nowIso : false;
          const leaseHolderEligible = input.leaseHolderNodeId
              ? ranked.some((c) => c.nodeId === input.leaseHolderNodeId)
              : false;

          const ownerNodeId = leaseActive && leaseHolderEligible && input.leaseHolderNodeId
              ? input.leaseHolderNodeId
              : selected.nodeId;

          const fencingToken = this.fencing.next();
          const forwardingRequired = ownerNodeId !== localNodeId;

          return {
              queue: input.queue, partitionKey: input.partitionKey,
              ownerNodeId,
              ownerServerUrl: this.resolveServerUrl(ownerNodeId),
              forwardingRequired,
              forwardedToNodeId: forwardingRequired ? ownerNodeId : null,
              leaseHandoff: Boolean(input.leaseHolderNodeId) && ownerNodeId !== input.leaseHolderNodeId,
              selectedAt: nowIso,
              candidates: input.includeCandidates
                  ? ranked
                  : ranked.filter((c) => c.nodeId === ownerNodeId),
          };
      }

      private buildCandidates(orgId: string | null): QueuePartitionCandidate[] {
          const local: QueuePartitionCandidate = {
              nodeId: this.identity.getNodeId(),
              ownerServerUrl: this.resolveServerUrl(this.identity.getNodeId()),
              role: this.identity.getLocalNode().roles[0] ?? "edge",
              local: true,
          };
          const remotes: QueuePartitionCandidate[] = this.membership.listRemoteNodes()
              .filter((n) => n.lifecycleState !== "isolated" && n.lifecycleState !== "leaving")
              .map((n) => ({
                  nodeId: n.nodeId,
                  ownerServerUrl: this.resolveServerUrl(n.nodeId),
                  role: n.roles[0] ?? "relay",
                  local: false,
              }));

          const all = [local, ...remotes];
          const allowed = new Set(
              this.overlayScope.filterForwardedNodeIdsByOrganization(all.map((c) => c.nodeId), orgId),
          );
          return all.filter((c) => allowed.has(c.nodeId));
      }

      private rendezvousScore(queue: string, partitionKey: string, nodeId: string): number {
          return createHash("sha256")
              .update(`${queue}:${partitionKey}:${nodeId}`)
              .digest()
              .readUInt32BE(0);
      }

      private hashPayload(payload: MeshQueueTransitionPayload): string {
          return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
      }

      private findByIdempotency(key: string): MeshQueueTransitionLogEntry | undefined {
          const entries = this.log.readFrom(0, 100_000);
          return entries.find((e) => e.payload.payload.idempotencyKey === key)?.payload;
      }

      private resolveServerUrl(nodeId: string): string | null {
          if (nodeId === this.identity.getNodeId()) return this.identity.resolveLocalServerUrl();
          const node = this.membership.getRemoteNode(nodeId);
          if (!node?.metadata || typeof node.metadata !== "object") return null;
          const url = node.metadata.serverUrl;
          return typeof url === "string" && url.length > 0 ? url : null;
      }
  }