import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "@/core/modules/database/services/database.service";
import { LocalEventOutboxDispatcherService } from "./local-event-outbox-dispatcher.service";

type OutboxRow = {
    id: string;
    state: "pending" | "sent" | "dead_letter";
    retryCount: number;
    payload: Record<string, unknown>;
    createdAt: Date;
};

function createDatabaseServiceMock(options?: { failFirstUpdate?: boolean }) {
    const selectQueue: unknown[][] = [];
    const insertValues: unknown[] = [];
    const updateSets: Array<Record<string, unknown>> = [];

    let updateAttempts = 0;

    const db = {
        insert: vi.fn(() => ({
            values: vi.fn(async (value: unknown) => {
                insertValues.push(value);
            }),
        })),
        update: vi.fn(() => ({
            set: vi.fn((value: Record<string, unknown>) => ({
                where: vi.fn(async () => {
                    updateAttempts += 1;
                    if (options?.failFirstUpdate && updateAttempts === 1) {
                        throw new Error("forced-update-failure");
                    }
                    updateSets.push(value);
                }),
            })),
        })),
        select: vi.fn(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => ({
                    orderBy: vi.fn(() => ({
                        limit: vi.fn(async () => selectQueue.shift() ?? []),
                    })),
                    limit: vi.fn(async () => selectQueue.shift() ?? []),
                })),
            })),
        })),
    };

    return {
        databaseService: { db } as unknown as DatabaseService,
        selectQueue,
        insertValues,
        updateSets,
    };
}

describe("LocalEventOutboxDispatcherService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("marks invalid envelopes as dead-letter", async () => {
        const mock = createDatabaseServiceMock();
        const service = new LocalEventOutboxDispatcherService(mock.databaseService);

        const dueRow: OutboxRow = {
            id: "outbox-1",
            state: "pending",
            retryCount: 0,
            payload: { invalid: true },
            createdAt: new Date(),
        };

        mock.selectQueue.push([dueRow], [dueRow]);

        await service.dispatchPending(10);

        expect(mock.updateSets.some((set) => set.state === "dead_letter")).toBe(true);
    });

    it("marks duplicate sent event envelopes as sent without re-dispatch", async () => {
        const mock = createDatabaseServiceMock();
        const service = new LocalEventOutboxDispatcherService(mock.databaseService);

        const payload = {
            eventId: "11111111-1111-4111-8111-111111111111",
            aggregateType: "service",
            aggregateId: "svc-1",
            eventType: "service.updated",
            version: "1",
            occurredAt: new Date().toISOString(),
            payload: { serviceId: "svc-1" },
            metadata: { source: "test" },
        };

        const dueRow: OutboxRow = {
            id: "outbox-2",
            state: "pending",
            retryCount: 0,
            payload,
            createdAt: new Date(),
        };

        mock.selectQueue.push([dueRow], [dueRow], [{ id: "already-sent" }]);

        await service.dispatchPending(10);

        expect(mock.updateSets.some((set) => set.state === "sent")).toBe(true);
    });

    it("schedules retry when dispatch update fails", async () => {
        const mock = createDatabaseServiceMock({ failFirstUpdate: true });
        const service = new LocalEventOutboxDispatcherService(mock.databaseService);

        const payload = {
            eventId: "22222222-2222-4222-8222-222222222222",
            aggregateType: "deployment",
            aggregateId: "dep-1",
            eventType: "deployment.updated",
            version: "1",
            occurredAt: new Date().toISOString(),
            payload: { deploymentId: "dep-1" },
            metadata: { source: "test" },
        };

        const dueRow: OutboxRow = {
            id: "outbox-3",
            state: "pending",
            retryCount: 0,
            payload,
            createdAt: new Date(),
        };

        mock.selectQueue.push([dueRow], [dueRow], []);

        await service.dispatchPending(10);

        const retryUpdate = mock.updateSets.find((set) => set.state === "pending" && set.retryCount === 1);
        expect(retryUpdate).toBeDefined();
    });
});
