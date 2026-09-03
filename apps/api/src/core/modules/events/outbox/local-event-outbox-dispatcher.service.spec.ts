import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppLifecyclePhase } from "@repo/nest-lifecycle";
import type { AppLifecycleService } from "@repo/nest-lifecycle";
import type { LocalEventOutboxRepository } from "./local-event-outbox.repository";
import { LocalEventOutboxDispatcherService } from "./local-event-outbox-dispatcher.service";

function createLifecycleMock(phase: AppLifecyclePhase = AppLifecyclePhase.READY) {
    return { phase } as unknown as AppLifecycleService;
}

type OutboxRow = {
    id: string;
    state: "pending" | "sent" | "dead_letter";
    retryCount: number;
    payload: Record<string, unknown>;
    createdAt: Date;
};

function createOutboxRepositoryMock() {
    const rows: OutboxRow[] = [];
    const updates: Array<Record<string, unknown> & { id: string }> = [];

    const repository = {
        findDue: vi.fn(async () => [...rows]),
        findById: vi.fn(async (id: string) => rows.find((row) => row.id === id) ?? null),
        hasSentDuplicateEventId: vi.fn(async () => false),
        markSent: vi.fn(async (id: string) => {
            updates.push({ id, state: "sent" });
            const row = rows.find((r) => r.id === id);
            if (row) row.state = "sent";
        }),
        scheduleRetry: vi.fn(async (id: string, retryCount: number, maxRetries: number) => {
            const nextRetryCount = retryCount + 1;
            if (nextRetryCount >= maxRetries) {
                updates.push({ id, state: "dead_letter", retryCount: nextRetryCount });
                return "dead_letter" as const;
            }
            updates.push({ id, state: "pending", retryCount: nextRetryCount });
            return "retry" as const;
        }),
        markDeadLetter: vi.fn(async (id: string, retryCount: number) => {
            updates.push({ id, state: "dead_letter", retryCount });
            const row = rows.find((r) => r.id === id);
            if (row) row.state = "dead_letter";
        }),
        enqueue: vi.fn(async () => undefined),
        findByTopic: vi.fn(async () => []),
    };

    return {
        repository: repository as unknown as LocalEventOutboxRepository,
        repositoryMock: repository,
        rows,
        updates,
    };
}

describe("LocalEventOutboxDispatcherService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("marks invalid envelopes as dead-letter", async () => {
        const mock = createOutboxRepositoryMock();
        const service = new LocalEventOutboxDispatcherService(
            {} as never,
            mock.repository,
            createLifecycleMock(),
        );

        mock.rows.push({
            id: "outbox-1",
            state: "pending",
            retryCount: 0,
            payload: { invalid: true },
            createdAt: new Date(),
        });

        await service.dispatchPending(10);

        expect(mock.updates.some((set) => set.state === "dead_letter")).toBe(true);
    });

    it("marks duplicate sent event envelopes as sent without re-dispatch", async () => {
        const mock = createOutboxRepositoryMock();
        const service = new LocalEventOutboxDispatcherService(
            {} as never,
            mock.repository,
            createLifecycleMock(),
        );

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

        mock.rows.push({
            id: "outbox-2",
            state: "pending",
            retryCount: 0,
            payload,
            createdAt: new Date(),
        });
        (mock.repositoryMock.hasSentDuplicateEventId as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

        await service.dispatchPending(10);

        expect(mock.updates.some((set) => set.state === "sent")).toBe(true);
    });

    it("schedules retry when dispatch update fails", async () => {
        const mock = createOutboxRepositoryMock();
        const service = new LocalEventOutboxDispatcherService(
            {} as never,
            mock.repository,
            createLifecycleMock(),
        );

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

        mock.rows.push({
            id: "outbox-3",
            state: "pending",
            retryCount: 0,
            payload,
            createdAt: new Date(),
        });
        // First markSent throws → retry scheduled.
        let markSentCalls = 0;
        (mock.repositoryMock.markSent as ReturnType<typeof vi.fn>).mockImplementation(async () => {
            markSentCalls += 1;
            if (markSentCalls === 1) throw new Error("forced-update-failure");
        });

        await service.dispatchPending(10);

        const retryUpdate = mock.updates.find((set) => set.state === "pending" && set.retryCount === 1);
        expect(retryUpdate).toBeDefined();
    });
});
