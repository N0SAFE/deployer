import { Inject, Injectable } from "@nestjs/common";
  import {
      meshPeerSessionSchema,
      type MeshPeerConnectInput,
      type MeshPeerConnectResult,
      type MeshPeerDisconnectInput,
      type MeshPeerDisconnectResult,
      type MeshPeerSession,
  } from "@repo/contracts-entities";
  import { CLOCK_TOKEN, type Clock } from "../../../shared/primitives/clock";
  import { ID_GENERATOR_TOKEN, type IdGenerator } from "../../../shared/primitives/id-generator";
  import { MeshNotFoundError } from "../domain/mesh-errors";
import { SystemMeshConfigService } from "../../system-mesh-config.service";
  import { timingSafeEqual } from "node:crypto"

  /**
   * Cycle de vie des sessions peer-to-peer :
   * création, déduplication, resume token, déconnexion.
   */
  @Injectable()
  export class MeshPeerSessionService {
      private readonly sessions = new Map<string, MeshPeerSession>();
      private readonly activeByEndpointUrl = new Map<string, string>();
      private readonly activeByPeerNodeId = new Map<string, string>();

      constructor(
          @Inject(CLOCK_TOKEN) private readonly clock: Clock,
          @Inject(ID_GENERATOR_TOKEN) private readonly idGen: IdGenerator,
          private readonly meshConfigService: SystemMeshConfigService,
      ) {}

      connect(input: MeshPeerConnectInput): MeshPeerConnectResult {
          const now = this.clock.nowIso();

          const resumed = this.tryResume(input, now);
          if (resumed) return resumed;

          const existingId = this.activeByEndpointUrl.get(input.endpointUrl);
          if (existingId) {
              const existing = this.sessions.get(existingId);
              if (existing && existing.state !== "closed") {
                  return { connected: true, deduplicated: true, resumed: false, session: existing };
              }
          }

          const created = meshPeerSessionSchema.parse({
              sessionId: this.idGen.uuid(),
              peerNodeId: null,
              endpointUrl: input.endpointUrl,
              state: "connected",
              reconnectAttempt: 0,
              nextReconnectAt: null,
              resumeToken: input.resumeToken ?? this.idGen.uuid(),
              duplicateSuppressed: false,
              duplicateOfSessionId: null,
              connectedAt: now,
              disconnectedAt: null,
              lastHeartbeatAt: now,
              metadata: {
                  ...(input.metadata ?? {}),
                  serverUrl: input.serverUrl ?? null,
                  remoteAuthSession: input.remoteAuthSession ?? null,
              },
          });

          this.sessions.set(created.sessionId, created);
          this.activeByEndpointUrl.set(created.endpointUrl, created.sessionId);
          return { connected: true, deduplicated: false, resumed: false, session: created };
      }

      disconnect(sessionId: string, input: MeshPeerDisconnectInput): MeshPeerDisconnectResult {
          const existing = this.sessions.get(sessionId);
          if (!existing) throw new MeshNotFoundError("MeshPeerSession", sessionId);

          const now = this.clock.nowIso();
          const attempt = input.allowReconnect
              ? existing.reconnectAttempt + 1
              : existing.reconnectAttempt;

          const updated: MeshPeerSession = {
              ...existing,
              state: input.allowReconnect ? "reconnecting" : "closed",
              reconnectAttempt: attempt,
              nextReconnectAt: input.allowReconnect
                  ? this.computeNextReconnectAt(attempt)
                  : null,
              disconnectedAt: now,
              metadata: {
                  ...(existing.metadata ?? {}),
                  disconnectReason: input.reason ?? null,
                  allowReconnect: input.allowReconnect,
              },
          };

          this.sessions.set(updated.sessionId, updated);

          if (!input.allowReconnect) {
              if (updated.peerNodeId && this.activeByPeerNodeId.get(updated.peerNodeId) === sessionId) {
                  this.activeByPeerNodeId.delete(updated.peerNodeId);
              }
              if (this.activeByEndpointUrl.get(updated.endpointUrl) === sessionId) {
                  this.activeByEndpointUrl.delete(updated.endpointUrl);
              }
          }

          return { disconnected: true, session: updated };
      }

      updateHeartbeat(
          sessionId: string,
          peerNodeId: string,
          now: string,
      ): MeshPeerSession {
          const existing = this.sessions.get(sessionId);
          if (!existing) throw new MeshNotFoundError("MeshPeerSession", sessionId);

          const updated: MeshPeerSession = {
              ...existing,
              peerNodeId,
              state: "connected",
              reconnectAttempt: 0,
              nextReconnectAt: null,
              lastHeartbeatAt: now,
              connectedAt: existing.connectedAt ?? now,
              duplicateSuppressed: false,
              duplicateOfSessionId: null,
          };

          this.sessions.set(updated.sessionId, updated);
          this.activeByPeerNodeId.set(peerNodeId, updated.sessionId);
          this.activeByEndpointUrl.set(updated.endpointUrl, updated.sessionId);
          return updated;
      }

      upsertFromReconcile(session: MeshPeerSession): boolean {
          const existing = this.sessions.get(session.sessionId);
          const existingSeen = existing?.lastHeartbeatAt ?? existing?.disconnectedAt ?? "";
          const incomingSeen = session.lastHeartbeatAt ?? session.disconnectedAt ?? "";
          if (existing && existingSeen > incomingSeen) return false;

          this.sessions.set(session.sessionId, session);
          if (session.state !== "closed" && session.peerNodeId) {
              this.activeByPeerNodeId.set(session.peerNodeId, session.sessionId);
          }
          if (session.state !== "closed") {
              this.activeByEndpointUrl.set(session.endpointUrl, session.sessionId);
          }
          return true;
      }

      removeByPeerNodeId(peerNodeId: string): void {
          for (const [sessionId, session] of this.sessions) {
              if (session.peerNodeId === peerNodeId) {
                  this.sessions.delete(sessionId);
                  this.activeByPeerNodeId.delete(peerNodeId);
                  this.activeByEndpointUrl.delete(session.endpointUrl);
              }
          }
      }

      getById(sessionId: string): MeshPeerSession | undefined {
          return this.sessions.get(sessionId);
      }

      getActiveByEndpointUrl(url: string): MeshPeerSession | undefined {
          const id = this.activeByEndpointUrl.get(url);
          return id ? this.sessions.get(id) : undefined;
      }

      resolveOrganizationId(sessionId: string): string | null {
          const session = this.sessions.get(sessionId);
          if (!session?.metadata || typeof session.metadata !== "object") return null;
          const orgId = session.metadata.organizationId;
          return typeof orgId === "string" && orgId.length > 0 ? orgId : null;
      }

      isValidCredential(credential: string): boolean {
          const configured = this.meshConfigService.getStreamSharedSecret()
              ?? process.env.MESH_STREAM_SHARED_SECRET?.trim()
              ?? null;
          if (!configured) return credential.trim().length > 0;
          // timingSafeEqual pour éviter timing attack
          const a = Buffer.from(credential);
          const b = Buffer.from(configured);
          if (a.length !== b.length) return false;
          return timingSafeEqual(a, b);
      }

      list(): MeshPeerSession[] {
          return [...this.sessions.values()].sort((a, b) => {
              const at = a.connectedAt ?? a.disconnectedAt ?? "";
              const bt = b.connectedAt ?? b.disconnectedAt ?? "";
              return bt.localeCompare(at);
          });
      }

      countConnected(): number {
          return [...this.sessions.values()].filter((s) => s.state === "connected").length;
      }

      private tryResume(input: MeshPeerConnectInput, now: string): MeshPeerConnectResult | null {
          if (!input.resumeToken) return null;
          const resumable = [...this.sessions.values()].find(
              (s) => s.resumeToken === input.resumeToken,
          );
          if (!resumable) return null;

          const resumed: MeshPeerSession = {
              ...resumable,
              endpointUrl: input.endpointUrl,
              state: "connected",
              reconnectAttempt: 0,
              nextReconnectAt: null,
              connectedAt: now,
              disconnectedAt: null,
              lastHeartbeatAt: now,
              duplicateSuppressed: false,
              duplicateOfSessionId: null,
              metadata: {
                  ...(resumable.metadata ?? {}),
                  resumedAt: now,
                  serverUrl: input.serverUrl ?? null,
                  remoteAuthSession: input.remoteAuthSession ?? null,
              },
          };

          this.sessions.set(resumed.sessionId, resumed);
          this.activeByEndpointUrl.set(resumed.endpointUrl, resumed.sessionId);
          if (resumed.peerNodeId) this.activeByPeerNodeId.set(resumed.peerNodeId, resumed.sessionId);
          return { connected: true, deduplicated: false, resumed: true, session: resumed };
      }

      private computeNextReconnectAt(attempt: number): string {
          const baseMs = Math.min(30_000, 500 * 2 ** attempt);
          const jitter = Math.random() * baseMs * 0.2;
          return new Date(this.clock.nowMs() + baseMs + jitter).toISOString();
      }
  }