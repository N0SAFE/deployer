import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppLifecyclePhase } from "@deployer/nest-lifecycle";
import type { AppLifecycleService } from "@deployer/nest-lifecycle";
import type { LocalEventOutboxRepository } from "@/core/modules/events/outbox/local-event-outbox.repository";
import { LocalEventOutboxDispatcherService } from "@/core/modules/events/outbox/local-event-outbox-dispatcher.service";

function createLifecycleMock(phase: AppLifecyclePhase = AppLifecyclePhase.READY) {
    return { phase } as unknown as AppLifecycleService;
}

type OutboxRow = {
    id: string;
    state: "pending" | "dispatching" | "sent" | "dead_letter";
    retryCount: number;
    payload: Record<string, unknown>;
    createdAt: Date;
};

/**
 * A repository mock that models the CLAIM, not a plain read.
 *
 * The previous mock returned `findDue()` rows on every call, which made a
 * concurrency test impossible to write: nothing represented "this row is now owned
 * by someone else". `claimDue` pops the rows it hands out, exactly like the real
 * UPDATE ... SKIP LOCKED does, so two dispatchers sharing this mock cannot both
 * receive the same row.
 */
function createOutboxRepositoryMock() {
    const rows: OutboxRow[] = [];
    const updates: Array<Record<string, unknown> & { id: string }> = [];
    const dispatched: string[] = [];

    const repository = {
        claimDue: vi.fn(async (limit: number) => {
            // Claimable = still pending. Claiming REMOVES it, as the real claim does.
            const claimed = rows.filter((r) => r.state === "pending").slice(0, limit);
            for (const row of claimed) row.state = "dispatching";
            return claimed;
        }),
        findById: vi.fn(async (id: string) => rows.find((row) => row.id === id) ?? null),
        hasSentDuplicateEventId: vi.fn(async () => false),
        markSent: vi.fn(async (id: string) => {
            updates.push({ id, state: "sent" });
            dispatched.push(id);
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
            const row = rows.find((r) => r.id === id);
            if (row) row.state = "pending";
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
        dispatched,
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

    /**
     * The bug this phase exists to fix.
     *
     * Four services (project, runtime, fleet) plus the monolith all run this
     * dispatcher against ONE table. With `findDue` the read was not a claim, so two
     * dispatchers could read the same pending row and both deliver it — the row was
     * only marked `sent` after the fact, which is too late to prevent the second
     * delivery.
     *
     * The claim makes ownership a precondition of reading: `claimDue` removes the
     * row from the claimable set before returning it, so a concurrent dispatcher
     * cannot see it. This test runs two dispatchers over one shared repository and
     * asserts each event is dispatched exactly once.
     */
    it("dispatches each event exactly once when two dispatchers run concurrently", async () => {
        const mock = createOutboxRepositoryMock();
        const first = new LocalEventOutboxDispatcherService(
            {} as never,
            mock.repository,
            createLifecycleMock(),
        );
        const second = new LocalEventOutboxDispatcherService(
            {} as never,
            mock.repository,
            createLifecycleMock(),
        );

        const EVENTS = 20;
        for (let i = 0; i < EVENTS; i += 1) {
            mock.rows.push({
                id: `outbox-${i}`,
                state: "pending",
                retryCount: 0,
                payload: {
                    eventId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
                    aggregateType: "service",
                    aggregateId: `svc-${i}`,
                    eventType: "service.updated",
                    version: "1",
                    occurredAt: new Date().toISOString(),
                    payload: { serviceId: `svc-${i}` },
                    metadata: { source: "test" },
                },
                createdAt: new Date(),
            });
        }

        // Both claim the whole backlog at once, so without a claim they would each
        // see all 20 and deliver 40.
        await Promise.all([first.dispatchPending(EVENTS), second.dispatchPending(EVENTS)]);

        const distinct = new Set(mock.dispatched);
        expect(mock.dispatched).toHaveLength(EVENTS);
        expect(distinct.size).toBe(EVENTS);
    });

    it("does not re-dispatch a row that is already claimed by another dispatcher", async () => {
        const mock = createOutboxRepositoryMock();
        const service = new LocalEventOutboxDispatcherService(
            {} as never,
            mock.repository,
            createLifecycleMock(),
        );

        mock.rows.push({
            id: "outbox-taken",
            state: "dispatching",
            retryCount: 0,
            payload: {
                eventId: "33333333-3333-4333-8333-333333333333",
                aggregateType: "service",
                aggregateId: "svc-taken",
                eventType: "service.updated",
                version: "1",
                occurredAt: new Date().toISOString(),
                payload: {},
                metadata: { source: "test" },
            },
            createdAt: new Date(),
        });

        await service.dispatchPending(10);

        // A row mid-dispatch belongs to someone else: it must not be claimed.
        expect(mock.dispatched).toHaveLength(0);
    });
});
