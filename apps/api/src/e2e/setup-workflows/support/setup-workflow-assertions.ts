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
  expect(snapshot.availableStrategies).toContain("local");
  expect(snapshot.availableStrategies).toContain("remote");
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
  expect(stateMachine.states).toContain("awaiting_strategy");
  expect(stateMachine.states).toContain("awaiting_credentials");
  expect(stateMachine.states).toContain("awaiting_remote_auth");
  expect(stateMachine.states).toContain("provisioning");
  expect(stateMachine.transitions.some((transition) => transition.event === "start_setup")).toBe(true);
  expect(stateMachine.transitions.some((transition) => transition.event === "choose_local")).toBe(true);
  expect(stateMachine.transitions.some((transition) => transition.event === "choose_remote")).toBe(true);
  expect(stateMachine.transitions.some((transition) => transition.event === "start_initialize")).toBe(true);
  expect(stateMachine.transitions.some((transition) => transition.event === "provisioning_complete")).toBe(true);
}
