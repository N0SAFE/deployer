import { describe, expect, it } from "vitest";

import {
  buildGetEventsOptions,
  buildStreamPoolKey,
  extractFastPathFilters,
  mapDockerEvent,
  resolveEventSource,
} from "./docker-event-mapping";

describe("docker event mapping", () => {
  it("resolves the source of a raw event, with anything unfamiliar as unknown", () => {
    expect(resolveEventSource("container")).toBe("container");
    expect(resolveEventSource("builder")).toBe("builder");
    expect(resolveEventSource("plugin")).toBe("unknown");
    expect(resolveEventSource(7)).toBe("unknown");
  });

  it("maps a container event with its name, image and exit code", () => {
    const event = mapDockerEvent({
      Type: "container",
      Action: "die",
      Actor: { ID: "abc", Attributes: { name: "api", image: "nginx", exitCode: "137" } },
      time: 1_700_000_000,
      timeNano: 1_700_000_000_123_456_789,
      id: "evt-1",
      scope: "local",
    });
    expect(event).toMatchObject({
      source: "container",
      action: "die",
      actorId: "abc",
      eventId: "evt-1",
      timestamp: "2023-11-14T22:13:20.000Z",
    });
    expect(event.payload).toMatchObject({ containerId: "abc", containerName: "api", image: "nginx", exitCode: 137 });
  });

  it("maps an event of an unknown type to an unknown-source event rather than failing", () => {
    const event = mapDockerEvent({ Type: "plugin", Action: "enable", Actor: { ID: "p1", Attributes: {} }, time: 1 });
    expect(event.source).toBe("unknown");
    expect(event.action).toBe("enable");
  });

  it("keys a subscription by its time window, sources and actions, order-insensitively", () => {
    const a = buildStreamPoolKey({ sources: ["image", "container"], actions: ["start", "die"] });
    const b = buildStreamPoolKey({ sources: ["container", "image"], actions: ["die", "start"] });
    expect(a).toBe(b);
    expect(buildStreamPoolKey({})).toContain("sources:*|actions:*");
  });

  it("asks the engine only for the sources and actions the filter names", () => {
    const filter = {
      _and: [{ source: { operator: "eq", value: "container" } }, { action: { operator: "in", value: ["start", "die"] } }],
    };
    const fast = extractFastPathFilters(filter);
    expect(fast.sources).toEqual(["container"]);
    expect(fast.actions).toEqual(["start", "die"]);
    const options = buildGetEventsOptions({ sources: fast.sources, actions: fast.actions, since: "100" });
    expect(options.since).toBe("100");
    expect(options.filters).toMatchObject({ type: ["container"] });
  });
});
