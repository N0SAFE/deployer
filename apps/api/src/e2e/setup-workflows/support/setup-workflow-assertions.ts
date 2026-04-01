import {
  nodeConfigStatusSchema,
  setupStateMachineSchema,
  setupStateSnapshotSchema,
  type NodeConfigStatus,
  type SetupStateMachine,
  type SetupStateSnapshot,
} from "@repo/contracts-entities";
import { expect } from "vitest";

export function parseSetupSnapshot(value: unknown): SetupStateSnapshot {
  return setupStateSnapshotSchema.parse(value);
}

export function parseNodeConfigStatus(value: unknown): NodeConfigStatus {
  return nodeConfigStatusSchema.parse(value);
}

export function parseSetupStateMachine(value: unknown): SetupStateMachine {
  return setupStateMachineSchema.parse(value);
}

export function assertNeedsSetupSnapshot(snapshot: SetupStateSnapshot): void {
  expect(snapshot.needsSetup).toBe(true);
  expect(snapshot.availableStrategies).toContain("local_instance");
  expect(snapshot.availableStrategies).toContain("remote_instance");
  expect(snapshot.progressPercent).toBeGreaterThanOrEqual(0);
  expect(snapshot.progressPercent).toBeLessThanOrEqual(100);
}

export function assertNodeStatusNotPersisted(nodeStatus: NodeConfigStatus): void {
  expect(nodeStatus.isConfigured).toBe(false);
  expect(nodeStatus.nodeId).toBeNull();
  expect(nodeStatus.configuredAt).toBeNull();
}

export function assertStateMachineWorkflowShape(stateMachine: SetupStateMachine): void {
  expect(stateMachine.initialState).toBe("not_started");
  expect(stateMachine.terminalStates).toContain("completed");
  expect(stateMachine.states).toContain("awaiting_initial_admin");
  expect(stateMachine.transitions.some((transition) => transition.event === "setup_detected")).toBe(true);
  expect(stateMachine.transitions.some((transition) => transition.event === "initial_organization_created")).toBe(true);
}
