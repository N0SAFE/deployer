import { firstValueFrom, from, toArray } from "rxjs";
import { describe, expect, it } from "vitest";

import {
  extractFastPathFilters,
  filterRuntimeEvents,
  isNotFoundError,
  matchesFieldFilter,
  matchesRuntimeEventFilter,
  resolveRefreshInterval,
} from "./runtime-event-filter";

const event = (over: Record<string, unknown> = {}) =>
  ({
    type: "docker_event",
    source: "container",
    action: "start",
    actorId: "abcdef123456",
    actorAttributes: {},
    scope: "local",
    from: null,
    eventId: "e1",
    nodeId: null,
    timestamp: "2026-10-01T00:00:00.000Z",
    timestampNano: null,
    raw: {},
    payload: { containerId: "abcdef123456", containerName: "api", imageId: null, imageName: null },
    ...over,
  }) as never;

describe("runtime event filter", () => {
  it("applies field operators, with unknown operators letting the value through", () => {
    expect(matchesFieldFilter("start", "eq", "start")).toBe(true);
    expect(matchesFieldFilter("start", "ne", "start")).toBe(false);
    expect(matchesFieldFilter("start", "in", ["start", "stop"])).toBe(true);
    expect(matchesFieldFilter("start", "nin", ["start"])).toBe(false);
    expect(matchesFieldFilter("Start", "ilike", "tar")).toBe(true);
    expect(matchesFieldFilter("start", "startsWith", "st")).toBe(true);
    expect(matchesFieldFilter(5, "gt", 3)).toBe(true);
  });

  it("matches a filter tree with _and and _or", () => {
    const tree = {
      _and: [{ source: { operator: "eq", value: "container" } }, { _or: [{ action: { operator: "eq", value: "stop" } }, { action: { operator: "eq", value: "start" } }] }],
    };
    expect(matchesRuntimeEventFilter(event(), tree)).toBe(true);
    expect(matchesRuntimeEventFilter(event({ action: "die" }), tree)).toBe(false);
    expect(matchesRuntimeEventFilter(event({ source: "image" }), tree)).toBe(false);
  });

  it("matches a container by id prefix or by name", () => {
    expect(matchesRuntimeEventFilter(event(), { containerId: { operator: "eq", value: "abcdef" } })).toBe(true);
    expect(matchesRuntimeEventFilter(event(), { containerName: { operator: "eq", value: "api" } })).toBe(true);
    expect(matchesRuntimeEventFilter(event(), { containerName: { operator: "eq", value: "web" } })).toBe(false);
  });

  it("reads fast-path filters out of the tree", () => {
    const fast = extractFastPathFilters({
      _and: [{ source: { operator: "eq", value: "container" } }, { action: { operator: "in", value: ["start", "metrics"] } }],
    });
    expect(fast.sources).toEqual(["container"]);
    expect(fast.actions).toEqual(["start", "metrics"]);
    expect(extractFastPathFilters(undefined)).toEqual({});
  });

  it("filters an event stream by source, action and the filter tree", async () => {
    const events = [event(), event({ action: "stop" }), event({ source: "image", action: "pull" })];
    const out = await firstValueFrom(
      filterRuntimeEvents(from(events), { sources: ["container"], actions: ["stop"] }).pipe(toArray()),
    );
    expect(out.map((e) => e.action)).toEqual(["stop"]);
  });

  it("clamps the inspect refresh interval and ignores non-integers", () => {
    expect(resolveRefreshInterval(10)).toBe(400);
    expect(resolveRefreshInterval(5000)).toBe(5000);
    expect(resolveRefreshInterval(10_000_000)).toBe(60_000);
    expect(resolveRefreshInterval(1.5)).toBeNull();
    expect(resolveRefreshInterval(undefined)).toBeNull();
  });

  it("recognises a not-found error by status or message", () => {
    expect(isNotFoundError({ statusCode: 404 })).toBe(true);
    expect(isNotFoundError(new Error("No such container: x"))).toBe(true);
    expect(isNotFoundError(new Error("boom"))).toBe(false);
    expect(isNotFoundError("nope")).toBe(false);
  });
});
