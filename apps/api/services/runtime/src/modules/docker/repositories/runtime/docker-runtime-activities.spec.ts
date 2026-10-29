import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { DockerRuntimeActivities } from "./docker-runtime-activities";
import { DockerRuntimeActivitiesStore } from "./docker-runtime-activities.store";

const at = new Date("2026-10-01T00:00:00.000Z");
const row = (id: string, over: Record<string, unknown> = {}) => ({
  id, eventId: id, eventFingerprint: `f-${id}`, flowId: "x:1", dependsOnFlowId: null, source: "container", action: "start",
  actorId: "a", status: "info", category: "runtime-event", severity: "info", progress: null, stage: null, scanner: null,
  message: null, actorAttributes: {}, payload: {}, raw: {}, occurredAt: at, createdAt: at, updatedAt: at, ...over,
});

const run = <A>(effect: Effect.Effect<A, unknown, unknown>, store: unknown) =>
  Effect.runPromise(effect.pipe(Effect.provideService(DockerRuntimeActivitiesStore, store as never)) as Effect.Effect<A>);

describe("DockerRuntimeActivities", () => {
  it("lists from the recent window, filtered and paged", async () => {
    const store = {
      listRecent: vi.fn(() =>
        Effect.succeed([
          row("00000000-0000-4000-8000-000000000001", { action: "start" }),
          row("00000000-0000-4000-8000-000000000002", { action: "die" }),
        ]),
      ),
    };
    const page = await run(
      DockerRuntimeActivities.live.list({ limit: 10, offset: 0, filter: { action: { operator: "eq", value: "die" } } } as never),
      store,
    );
    expect(store.listRecent).toHaveBeenCalledWith(5000);
    expect(page.data.map((item) => item.action)).toEqual(["die"]);
    expect(page.meta.total).toBe(1);
  });

  it("finds one activity or null", async () => {
    const store = { findById: vi.fn((id: string) => Effect.succeed(id === "missing" ? null : row(id))) };
    await expect(run(DockerRuntimeActivities.live.getById({ id: "missing" } as never), store)).resolves.toBeNull();
    const found = await run(DockerRuntimeActivities.live.getById({ id: "00000000-0000-4000-8000-000000000009" } as never), store);
    expect(found?.id).toBe("00000000-0000-4000-8000-000000000009");
  });

  it("persists the record an event builds", async () => {
    const store = { insert: vi.fn(() => Effect.void) };
    await run(
      DockerRuntimeActivities.live.persist({
        type: "docker_event", source: "container", action: "start", actorId: "c1", actorAttributes: {}, scope: null,
        from: null, eventId: "e1", nodeId: null, timestamp: at.toISOString(), timestampNano: null, raw: {},
        payload: { containerId: "c1", containerName: null, image: null, exitCode: null, signal: null },
      } as never),
      store,
    );
    expect(store.insert).toHaveBeenCalledWith(expect.objectContaining({ source: "container", action: "start", actorId: "c1" }));
  });
});
