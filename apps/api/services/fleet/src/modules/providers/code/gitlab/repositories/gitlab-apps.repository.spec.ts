import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { FleetDb } from "@/core/database/fleet-db";

import { GitlabAppsStore } from "./gitlab-apps.repository";

/** A Drizzle stand-in: every builder call answers the builder, awaiting it answers `rows`. */
function run<A, E, R>(effect: Effect.Effect<A, E, R>, rows: unknown[]): Promise<A> {
    const builder: object = new Proxy(
        {},
        {
            get(_target, key) {
                if (key === "then") return (resolve: (value: unknown) => void) => { resolve(rows); };
                return () => builder;
            },
        },
    );
    const database = { use: (use: (db: object) => Promise<unknown>) => Effect.tryPromise({ try: () => use(builder), catch: (cause) => cause }) };
    return Effect.runPromise(effect.pipe(Effect.provideService(FleetDb, database as never)) as Effect.Effect<A, E>);
}

describe("GitlabAppsStore", () => {
    it("finds an account by name, or null when there is none", async () => {
        expect(await run(GitlabAppsStore.live.findByName("main"), [{ id: "g1" }])).toEqual({ id: "g1" });
        expect(await run(GitlabAppsStore.live.findByName("main"), [])).toBeNull();
    });

    it("answers the created row, or null when the insert returned none", async () => {
        const input = { name: "main", url: "https://gitlab.example.com", accessToken: "tok" };
        expect(await run(GitlabAppsStore.live.create(input), [{ id: "g1", ...input }])).toMatchObject({ id: "g1" });
        expect(await run(GitlabAppsStore.live.create(input), [])).toBeNull();
    });

    it("answers the removed id, or null when the account did not exist", async () => {
        expect(await run(GitlabAppsStore.live.deleteById("g1"), [{ id: "g1" }])).toEqual({ id: "g1" });
        expect(await run(GitlabAppsStore.live.deleteById("g1"), [])).toBeNull();
    });
});
