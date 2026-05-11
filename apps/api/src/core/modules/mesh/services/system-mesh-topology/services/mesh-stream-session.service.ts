import { Injectable } from "@nestjs/common";
  import { Observable } from "rxjs";
  import {
      meshDuplexStreamInputSchema,
      type MeshDuplexStreamInput,
      type MeshDuplexStreamOutput,
  } from "@repo/contracts-entities";
  import { observableToAsyncIterable } from "@/core/utils/observable.utils";
  import type { MeshPeerSessionService } from "./mesh-peer-session.service";
  import type { MeshHealthMonitorService } from "./mesh-health-monitor.service";
  import type { MeshMembershipService } from "./mesh-membership.service";
  import type { MeshControlPlaneService } from "./mesh-control-plane.service";
  import type { MeshIdentityService } from "./mesh-identity.service";

  /**
   * Boucle duplex WebSocket d'une session peer.
   *
   * Protocole :
   *  1. Premier event = auth (credential + endpointUrl)
   *  2. Snapshot immédiat après auth
   *  3. ping/pong, snapshot_request, reconcile, control, heartbeat, disconnect
   *
   * Backpressure : le stream est pull-based côté consommateur (AsyncIterable).
   * La boucle ne produit rien tant que le consommateur ne consomme pas.
   */
  @Injectable()
  export class MeshStreamSessionService {
      constructor(
          private readonly identity: MeshIdentityService,
          private readonly sessions: MeshPeerSessionService,
          private readonly health: MeshHealthMonitorService,
          private readonly membership: MeshMembershipService,
          private readonly controlPlane: MeshControlPlaneService,
      ) {}

      streamSession(
          inputStream: AsyncIterable<MeshDuplexStreamInput>,
      ): AsyncIterable<MeshDuplexStreamOutput> {
          return observableToAsyncIterable(
              this.observeSession(
                  new Observable((sub) => {
                      void (async () => {
                          try {
                              for await (const event of inputStream) {
                                  if (sub.closed) break;
                                  sub.next(event);
                              }
                              sub.complete();
                          } catch (err) {
                              sub.error(err);
                          }
                      })();
                  }),
              ),
          );
      }

      observeSession(
          input$: Observable<MeshDuplexStreamInput>,
      ): Observable<MeshDuplexStreamOutput> {
          return new Observable<MeshDuplexStreamOutput>((subscriber) => {
              let activeSessionId: string | null = null;
              let seenFirstEvent = false;
              let terminated = false;

              const emit = (event: MeshDuplexStreamOutput): void => {
                  if (!subscriber.closed) subscriber.next(event);
              };

              const terminate = (): void => {
                  if (terminated) return;
                  terminated = true;
                  sub.unsubscribe();
                  if (!subscriber.closed) subscriber.complete();
              };

              const cleanupSession = (): void => {
                  if (!activeSessionId) return;
                  try {
                      this.sessions.disconnect(activeSessionId, {
                          reason: "stream_closed",
                          allowReconnect: true,
                      });
                  } catch {
                      // Ignore — session peut déjà être fermée
                  }
                  activeSessionId = null;
              };

              const sub = input$.subscribe({
                  next: (raw) => {
                      if (terminated || subscriber.closed) return;

                      // ── Premier event : auth obligatoire ──────────────────
                      if (!seenFirstEvent) {
                          seenFirstEvent = true;
                          const parsed = meshDuplexStreamInputSchema.safeParse(raw);

                          if (!parsed.success || parsed.data.type !== "auth") {
                              emit({ type: "error", code: "auth_required", message: "First event must be auth", retryable: false });
                              cleanupSession();
                              terminate();
                              return;
                          }

                          if (!this.sessions.isValidCredential(parsed.data.credential)) {
                              emit({ type: "error", code: "unauthorized", message: "Invalid mesh stream credential", retryable: false });
                              cleanupSession();
                              terminate();
                              return;
                          }

                          const connected = this.sessions.connect({
                              endpointUrl: parsed.data.endpointUrl,
                              serverUrl: parsed.data.serverUrl,
                              resumeToken: parsed.data.resumeToken,
                              remoteAuthSession: parsed.data.remoteAuthSession,
                              metadata: parsed.data.metadata,
                          });

                          activeSessionId = connected.session.sessionId;

                          emit({ type: "auth_ok", session: connected.session, localNode: this.identity.getLocalNode() });
                          emit({ type: "snapshot", snapshot: this.membership.getSnapshot() });
                          return;
                      }

                      // ── Events suivants ───────────────────────────────────
                      const parsed = meshDuplexStreamInputSchema.safeParse(raw);
                      if (!parsed.success) {
                          emit({ type: "error", code: "invalid_event", message: "Invalid mesh stream event payload", retryable: true });
                          return;
                      }

                      if (parsed.data.type === "auth") {
                          emit({ type: "error", code: "invalid_sequence", message: "Auth can only be sent once", retryable: false });
                          return;
                      }

                      try {
                          this.handleEvent(parsed.data, activeSessionId, emit, terminate, cleanupSession);
                      } catch (error) {
                          emit({
                              type: "error",
                              code: "processing_error",
                              message: error instanceof Error ? error.message : "Failed to process mesh stream event",
                              retryable: true,
                          });
                      }
                  },

                  error: (err: unknown) => {
                      cleanupSession();
                      if (!subscriber.closed) subscriber.error(err);
                  },

                  complete: () => {
                      if (!seenFirstEvent) {
                          emit({ type: "error", code: "auth_required", message: "Stream closed before auth", retryable: false });
                      }
                      cleanupSession();
                      terminate();
                  },
              });

              return () => {
                  cleanupSession();
                  sub.unsubscribe();
              };
          });
      }

      // ─── Dispatch interne ─────────────────────────────────────────────────────

      private handleEvent(
          data: MeshDuplexStreamInput,
          activeSessionId: string | null,
          emit: (e: MeshDuplexStreamOutput) => void,
          terminate: () => void,
          cleanupSession: () => void,
      ): void {
          if (data.type === "ping") {
              emit({ type: "pong", nonce: data.nonce, timestamp: new Date().toISOString() });
              return;
          }

          if (data.type === "snapshot_request") {
              emit({ type: "snapshot", snapshot: this.membership.getSnapshot() });
              return;
          }

          if (data.type === "reconcile") {
              const result = this.membership.reconcile(data.reconcile);
              emit({ type: "reconcile_result", result });
              return;
          }

          if (data.type === "control") {
              const orgId = activeSessionId
                  ? this.sessions.resolveOrganizationId(activeSessionId)
                  : null;
              const scoped = this.controlPlane.applySessionScope(data.envelope, orgId);
              if (!scoped) {
                  emit({ type: "error", code: "invalid_event", message: "Control envelope org scope mismatch", retryable: false });
                  return;
              }
              const response = this.controlPlane.publish(scoped);
              emit({ type: "control_ack", accepted: response.accepted, envelopeId: response.envelopeId, forwardedTo: response.forwardedTo });
              return;
          }

          if (data.type === "heartbeat") {
              if (!activeSessionId) {
                  emit({ type: "error", code: "invalid_sequence", message: "Cannot heartbeat before auth", retryable: false });
                  return;
              }
              const result = this.health.heartbeat(activeSessionId, {
                  peerNodeId: data.peerNodeId,
                  latencyMs: data.latencyMs,
                  jitterMs: data.jitterMs,
                  packetLossRatio: data.packetLossRatio,
                  throughputMbps: data.throughputMbps,
                  reliabilityScore: data.reliabilityScore,
              });
              emit({ type: "heartbeat_ack", session: result.session, connection: result.connection });
              return;
          }

          if (data.type === "disconnect") {
              if (!activeSessionId) {
                  emit({ type: "error", code: "invalid_sequence", message: "Cannot disconnect before auth", retryable: false });
                  cleanupSession();
                  terminate();
                  return;
              }
              const result = this.sessions.disconnect(activeSessionId, {
                  reason: data.reason,
                  allowReconnect: data.allowReconnect,
              });
              emit({ type: "disconnected", session: result.session });
              activeSessionId = null;
              terminate();
          }
      }
  }