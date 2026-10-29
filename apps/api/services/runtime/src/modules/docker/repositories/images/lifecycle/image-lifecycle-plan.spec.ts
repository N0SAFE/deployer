import { describe, expect, it } from "vitest";

import { planAliveLifecycle } from "./image-lifecycle-plan";

describe("planAliveLifecycle", () => {
  it("creates generation 1 on first sight", () => {
    expect(planAliveLifecycle(null)).toEqual({ action: "create", generation: 1, event: "image_created" });
  });

  it("starts a new generation when a deleted image returns", () => {
    expect(planAliveLifecycle({ currentGeneration: 3, lifecycleState: "deleted" })).toEqual({
      action: "revive",
      generation: 4,
      event: "image_revived",
    });
  });

  it("keeps the generation of an image that is still alive", () => {
    expect(planAliveLifecycle({ currentGeneration: 2, lifecycleState: "alive" })).toEqual({
      action: "touch",
      generation: 2,
      event: null,
    });
  });
});
