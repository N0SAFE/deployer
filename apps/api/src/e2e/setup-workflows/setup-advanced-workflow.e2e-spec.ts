import { beforeAll, describe, expect, it } from "vitest";
import {
  assertStateMachineWorkflowShape,
  parseNodeConfigStatus,
  parseSetupSnapshot,
  parseSetupStateMachine,
} from "./support/setup-workflow-assertions";
import { createSetupWorkflowContext, type SetupWorkflowContext } from "./support/setup-workflow-context";
import { firstValueFrom, toArray } from "rxjs";

describe("Setup API e2e: advanced workflow orchestration", () => {
  let context: SetupWorkflowContext;

  beforeAll(async () => {
    context = await createSetupWorkflowContext();
  });

  // --- Tests for removed endpoints are removed ---
  // configureDatabase was removed during the v3 migration; its functionality
  // is now part of the SSE-based initialize flow. See setup wizard page tests
  // for UI-level coverage of that flow.

  it("rejects remote-instance initialize strategy and keeps setup state pending", async () => {
    // initialize returns an Observable<SetupStreamEvent> at the type level.
    // The ObservableLinkPlugin converts the transport AsyncIterable to Observable
    // so runtime matches the type-level contract.
    const result = await context.orpc.initialize({
      strategy: "remote",
      meshUrl: "https://remote-node.example.test",
      authToken: "invalid-token",
    });

    const events = await firstValueFrom(result.pipe(toArray()))
    
    // The server emits step_failed (not a top-level error event) when
    // the remote mesh URL cannot be reached
    const hasStepFailed = events.some((event) => event.type === "step_failed");
    expect(hasStepFailed).toBe(true);

    const statusAfter = parseSetupSnapshot(await context.orpc.getState());
    expect(statusAfter.needsSetup).toBe(true);
  });

  it("exposes node status with consistent shape through ORPC", async () => {
    const orpcNodeStatus = await context.orpc.getNodeStatus();
    const parsedOrpcNodeStatus = parseNodeConfigStatus(orpcNodeStatus);

    expect(parsedOrpcNodeStatus.isConfigured).toBe(false);
    expect(parsedOrpcNodeStatus.nodeId).toBeNull();
    expect(parsedOrpcNodeStatus.configuredAt).toBeNull();
  });

  it("reports setup state as not completed initially", async () => {
    const orpcState = await context.orpc.getState();
    expect(orpcState.needsSetup).toBe(true);
    expect(orpcState.state).toBeDefined();
  });
});
