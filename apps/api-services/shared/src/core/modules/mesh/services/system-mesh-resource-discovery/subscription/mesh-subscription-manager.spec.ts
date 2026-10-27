import { describe, expect, it } from "vitest";

import { MeshSubscriptionManager } from "./mesh-subscription-manager";

type Item = { id: string; value: number };

/** Lets the manager's asynchronous handlers run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("MeshSubscriptionManager", () => {
  // The item schema is only used by remote-facing code paths; the notifier does not read it.
  const noSchema = null as never;

  it("hands back the same notifier for the same key and a different one for another key", () => {
    const manager = new MeshSubscriptionManager();

    const projects = manager.registerGlobalResource("test:projects", noSchema);

    expect(manager.registerGlobalResource("test:projects", noSchema)).toBe(projects);
    expect(manager.registerGlobalResource("test:users", noSchema)).not.toBe(projects);
  });

  it("notifies every subscriber of created, updated and deleted items", async () => {
    const manager = new MeshSubscriptionManager();
    const notifier = manager.registerGlobalResource<Item>("test:global", noSchema);
    const events: string[] = [];
    manager.subscribe<Item>("test:global", (evt) => {
      events.push(`h1:${evt.type}:${evt.item.id}`);
      return Promise.resolve();
    });
    manager.subscribe<Item>("test:global", (evt) => {
      events.push(`h2:${evt.type}:${evt.item.id}`);
      return Promise.resolve();
    });

    await notifier.notifyCreated({ id: "a", value: 1 }, "node-a");
    await notifier.notifyUpdated({ id: "a", value: 2 }, { id: "a", value: 1 }, "node-a");
    await notifier.notifyDeleted({ id: "a", value: 2 }, "node-a");
    await settle();

    expect(events).toEqual(
      expect.arrayContaining(["h1:created:a", "h2:created:a", "h1:updated:a", "h1:deleted:a"]),
    );
  });

  it("stops notifying a subscriber once it unsubscribes", async () => {
    const manager = new MeshSubscriptionManager();
    const notifier = manager.registerGlobalResource<Item>("test:global", noSchema);
    const events: string[] = [];
    const handle = manager.subscribe<Item>("test:global", (evt) => {
      events.push(evt.type);
      return Promise.resolve();
    });

    handle.unsubscribe();
    await notifier.notifyCreated({ id: "b", value: 5 }, "node-a");
    await settle();

    expect(events).toHaveLength(0);
  });

  it("delivers an event only to subscribers of its own key", async () => {
    const manager = new MeshSubscriptionManager();
    const projects = manager.registerGlobalResource<Item>("projects", noSchema);
    const users = manager.registerGlobalResource<Item>("users", noSchema);
    const projectEvents: string[] = [];
    const userEvents: string[] = [];
    manager.subscribe<Item>("projects", (evt) => {
      projectEvents.push(`${evt.type}:${evt.item.id}`);
      return Promise.resolve();
    });
    manager.subscribe<Item>("users", (evt) => {
      userEvents.push(`${evt.type}:${evt.item.id}`);
      return Promise.resolve();
    });

    await projects.notifyCreated({ id: "p1", value: 1 }, "node-a");
    await users.notifyUpdated({ id: "u1", value: 5 }, { id: "u1", value: 3 }, "node-b");
    await settle();

    expect(projectEvents).toEqual(["created:p1"]);
    expect(userEvents).toEqual(["updated:u1"]);
  });
});
