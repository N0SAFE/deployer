import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FleetDb } from "@/core/database/fleet-db";

import { GithubAppsStore } from "./github-apps.repository";

/**
 * A Drizzle stand-in: every builder call answers the same builder (recording its name), and awaiting
 * the builder answers the next queued result, or rejects when it is a failure.
 */
function fakeDb(results: unknown[]) {
    const calls: string[] = [];
    const queue = [...results];
    const builder: object = new Proxy(
        {},
        {
            get(_target, key) {
                if (key === "then") {
                    return (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => {
                        const next = queue.shift();
                        if (next instanceof Error) reject(next);
                        else resolve(next);
                    };
                }
                return () => {
                    calls.push(typeof key === "string" ? key : "symbol");
                    return builder;
                };
            },
        },
    );
    const database = { use: (run: (db: object) => Promise<unknown>) => Effect.tryPromise({ try: () => run(builder), catch: (cause) => cause }) };
    /** The store, run over the fake database. */
    const run = <A, E, R>(effect: Effect.Effect<A, E, R>): Promise<A> =>
        Effect.runPromise(effect.pipe(Effect.provideService(FleetDb, database as never)) as Effect.Effect<A, E>);
    return { run, calls };
}

describe("GithubAppsStore", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("claimWebhookDelivery", () => {
        it("is true for the first delivery: the insert returned its row", async () => {
            const { run, calls } = fakeDb([[{ id: "evt-1" }]]);

            expect(await run(GithubAppsStore.live.claimWebhookDelivery({ event: "push", deliveryId: "d-1", payload: {} }))).toBe(true);
            expect(calls).toContain("onConflictDoNothing");
        });

        it("is false for a redelivery: the conflicting insert returned nothing", async () => {
            const { run } = fakeDb([[]]);

            expect(await run(GithubAppsStore.live.claimWebhookDelivery({ event: "push", deliveryId: "d-1", payload: {} }))).toBe(false);
        });
    });

    describe("getWebhookSecret", () => {
        it("reads the secret from the github_webhook config", async () => {
            const { run } = fakeDb([[{ key: "github_webhook", value: JSON.stringify({ webhookSecret: "s3cret" }) }]]);

            expect(await run(GithubAppsStore.live.getWebhookSecret())).toBe("s3cret");
        });

        it("is null when the config is absent, has no secret, or is not JSON", async () => {
            expect(await fakeDb([[]]).run(GithubAppsStore.live.getWebhookSecret())).toBeNull();
            expect(await fakeDb([[{ value: JSON.stringify({}) }]]).run(GithubAppsStore.live.getWebhookSecret())).toBeNull();
            expect(await fakeDb([[{ value: "{not json" }]]).run(GithubAppsStore.live.getWebhookSecret())).toBeNull();
        });

        it("is null when the database is not available, so the webhook guard fails closed", async () => {
            const { run } = fakeDb([new Error("connection refused")]);

            expect(await run(GithubAppsStore.live.getWebhookSecret())).toBeNull();
        });
    });

    describe("findServiceBySourceUrl", () => {
        const serviceRow = (id: string, sourceUrl: string | null) => ({ id, providerConfig: sourceUrl === null ? null : { sourceUrl } });

        it("matches the repository URL ignoring case, surrounding spaces and trailing slashes", async () => {
            const { run } = fakeDb([[serviceRow("svc-a", "https://github.com/other/repo"), serviceRow("svc-b", "  HTTPS://GitHub.com/Org/Repo// ")]]);

            expect(await run(GithubAppsStore.live.findServiceBySourceUrl("https://github.com/org/repo/"))).toMatchObject({ id: "svc-b" });
        });

        it("is null when no service is linked to the repository", async () => {
            const { run } = fakeDb([[serviceRow("svc-a", null), serviceRow("svc-b", "https://github.com/other/repo")]]);

            expect(await run(GithubAppsStore.live.findServiceBySourceUrl("https://github.com/org/repo"))).toBeNull();
        });
    });

    describe("rows", () => {
        it("answers null when an insert or an update returned no row", async () => {
            const input = { name: "n", appId: "1", clientId: "c", clientSecret: "s", privateKey: "k", webhookSecret: "w" };
            expect(await fakeDb([[]]).run(GithubAppsStore.live.create(input))).toBeNull();
            expect(await fakeDb([[]]).run(GithubAppsStore.live.updateById("missing", { name: "x" }))).toBeNull();
            expect(await fakeDb([[]]).run(GithubAppsStore.live.setInstallationByName("missing", "42"))).toBeNull();
        });

        it("answers whether an installation id matched an app", async () => {
            expect(await fakeDb([[{ id: "a1" }]]).run(GithubAppsStore.live.setInstallation("7", "42"))).toBe(true);
            expect(await fakeDb([[]]).run(GithubAppsStore.live.setInstallation("7", null))).toBe(false);
        });

        it("scopes provider apps by id when given, else to the active ones", async () => {
            const scoped = fakeDb([[{ id: "a1" }]]);
            await scoped.run(GithubAppsStore.live.findProviderApps("a1"));
            expect(scoped.calls).toContain("limit");

            const active = fakeDb([[{ id: "a1" }]]);
            await active.run(GithubAppsStore.live.findProviderApps());
            expect(active.calls).not.toContain("limit");
        });
    });
});
