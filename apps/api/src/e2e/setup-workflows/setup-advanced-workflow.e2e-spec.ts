import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  assertNeedsSetupSnapshot,
  assertNodeStatusNotPersisted,
  assertStateMachineWorkflowShape,
  parseNodeConfigStatus,
  parseSetupSnapshot,
  parseSetupStateMachine,
} from "./support/setup-workflow-assertions";
import { createSetupWorkflowContext, type SetupWorkflowContext } from "./support/setup-workflow-context";

describe("Setup API e2e: advanced workflow orchestration", () => {
  let context: SetupWorkflowContext;

  beforeAll(async () => {
    context = await createSetupWorkflowContext();
  });

  it("rejects an unreachable database URL and preserves setup prerequisites", async () => {
    const statusBefore = parseSetupSnapshot(await context.orpc.getStatus());
    assertNeedsSetupSnapshot(statusBefore);

    const response = await context.http
      .post("/setup/configure-database")
      .send({
        databaseUrl: "postgres://deployer:deployer@127.0.0.1:1/deployer_unreachable",
        testOnly: true,
      })
      .expect(400);

    expect(String(response.body.message)).toContain("Cannot connect to the provided database URL");

    const statusAfter = parseSetupSnapshot(await context.orpc.getStatus());
    assertNeedsSetupSnapshot(statusAfter);
    expect(statusAfter.state).toBe(statusBefore.state);

    const nodeStatus = parseNodeConfigStatus(await context.orpc.getNodeStatus());
    assertNodeStatusNotPersisted(nodeStatus);
  });

  it("keeps REST and oRPC setup views consistent after successful testOnly validation", async () => {
    const configureResult = await context.orpc.configureDatabase({
      databaseUrl: context.databaseUrl,
      testOnly: true,
    });

    expect(configureResult.connected).toBe(true);
    expect(configureResult.isNewDatabase).toBe(true);
    expect(configureResult.nodeId).toBeTypeOf("string");

    const orpcStatus = parseSetupSnapshot(await context.orpc.getStatus());
    assertNeedsSetupSnapshot(orpcStatus);

    const restStatusResponse = await context.http.get("/setup/status").expect(200);
    const restStatus = parseSetupSnapshot(restStatusResponse.body);

    expect(restStatus.state).toBe(orpcStatus.state);
    expect(restStatus.currentStep).toBe(orpcStatus.currentStep);
    expect(restStatus.needsSetup).toBe(orpcStatus.needsSetup);

    const stateMachineResponse = await context.http.get("/setup/state-machine").expect(200);
    const stateMachine = parseSetupStateMachine(stateMachineResponse.body);
    assertStateMachineWorkflowShape(stateMachine);
  });

  it("supports concurrent testOnly validations without persisting node configuration", async () => {
    const forcedNodeId = randomUUID();

    const [forced, autoA, autoB] = await Promise.all([
      context.orpc.configureDatabase({
        databaseUrl: context.databaseUrl,
        testOnly: true,
        nodeId: forcedNodeId,
      }),
      context.orpc.configureDatabase({
        databaseUrl: context.databaseUrl,
        testOnly: true,
      }),
      context.orpc.configureDatabase({
        databaseUrl: context.databaseUrl,
        testOnly: true,
      }),
    ]);

    expect(forced.connected).toBe(true);
    expect(forced.nodeId).toBe(forcedNodeId);
    expect(autoA.connected).toBe(true);
    expect(autoA.nodeId).toBeTypeOf("string");
    expect(autoB.connected).toBe(true);
    expect(autoB.nodeId).toBeTypeOf("string");

    const nodeStatus = parseNodeConfigStatus(await context.orpc.getNodeStatus());
    assertNodeStatusNotPersisted(nodeStatus);
  });

  it("rejects remote-instance initialize strategy and keeps setup state pending", async () => {
    const response = await context.http
      .post("/setup/initialize")
      .send({
        strategy: "remote_instance",
        name: "Remote Bootstrap Admin",
        email: `remote-bootstrap-${randomUUID()}@example.test`,
        password: "P@ssword1234",
        remoteServerUrl: "https://remote-node.example.test",
      })
      .expect(400);

    expect(String(response.body.message)).toContain("Remote-instance strategy is handled by setup remote-connect flow");

    const statusAfter = parseSetupSnapshot(await context.orpc.getStatus());
    assertNeedsSetupSnapshot(statusAfter);
  });

  it("rejects configure-database payload with invalid nodeId format", async () => {
    await context.http
      .post("/setup/configure-database")
      .send({
        databaseUrl: context.databaseUrl,
        testOnly: true,
        nodeId: "not-a-uuid",
      })
      .expect(400);

    const statusAfter = parseSetupSnapshot(await context.orpc.getStatus());
    assertNeedsSetupSnapshot(statusAfter);
  });

  it("keeps REST and oRPC node-status views consistent", async () => {
    const [restNodeStatusResponse, orpcNodeStatus] = await Promise.all([
      context.http.get("/setup/node-status").expect(200),
      context.orpc.getNodeStatus(),
    ]);

    const restNodeStatus = parseNodeConfigStatus(restNodeStatusResponse.body);
    const parsedOrpcNodeStatus = parseNodeConfigStatus(orpcNodeStatus);

    expect(restNodeStatus.isConfigured).toBe(parsedOrpcNodeStatus.isConfigured);
    expect(restNodeStatus.nodeId).toBe(parsedOrpcNodeStatus.nodeId);
    expect(restNodeStatus.configuredAt).toBe(parsedOrpcNodeStatus.configuredAt);
  });

  it("exposes a coherent setup state machine without duplicate state identifiers", async () => {
    const stateMachine = parseSetupStateMachine(await context.orpc.getStateMachine());
    assertStateMachineWorkflowShape(stateMachine);

    const uniqueStates = new Set(stateMachine.states);
    expect(uniqueStates.size).toBe(stateMachine.states.length);
    expect(uniqueStates.has(stateMachine.initialState)).toBe(true);
    expect(stateMachine.terminalStates.every((terminal) => uniqueStates.has(terminal))).toBe(true);

    for (const transition of stateMachine.transitions) {
      expect(uniqueStates.has(transition.from)).toBe(true);
      expect(uniqueStates.has(transition.to)).toBe(true);
      expect(transition.event.length).toBeGreaterThan(0);
    }
  });
});
