import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { SetupStepId } from "@repo/contracts-entities";
import { SetupStepTracker } from "../services/setup-step-tracker";

/**
 * Re-export of the step tracker so callers can import the full
 * "run a step" surface from one place. Avoids needing to know the
 * service-internal file layout.
 */
export { SetupStepTracker };

/**
 * A closure that the local/remote services receive from the
 * orchestration layer. It is bound to a specific run and pushes
 * events through the core event service.
 *
 * The closure is the only thing that needs to know about the
 * `progress` channel of the event service. The services themselves
 * stay pure: they only call `emit(snapshotEvent)` or
 * `emit(logEvent)` after updating the tracker.
 */
export type EmitEvent = (event: import("@repo/contracts-entities").SetupStreamEvent) => void;

/**
 * Run a single step with automatic `step_detail` / `start` / `complete` / `fail`
 * semantics.
 *
 * - Emits a `step_detail` event so the UI learns about this step
 *   dynamically — no hardcoded templates needed on the frontend.
 * - Updates the tracker with `start()`.
 * - Exposes a `stepLog` helper to the body that both appends to the
 *   tracker AND emits a `log` event through the event service.
 * - On success, calls `complete()` and emits a fresh `snapshot`.
 * - On failure, calls `fail()`, emits a fresh `snapshot`, and re-throws
 *   so the orchestration layer can dispatch the terminal `error` event.
 *
 * The body callback is the only place the actual work happens. This
 * keeps the detail/start/log/complete/fail dance in ONE place and
 * removes a class of "forgot to call complete" bugs. The body can be
 * sync or async — both are awaited transparently.
 */
export async function runStep<T>(
    tracker: SetupStepTracker,
    emit: EmitEvent,
    stepId: SetupStepId,
    title: string,
    body: (log: (line: string) => void) => T | Promise<T>,
    description?: string,
): Promise<T> {
    // Tell the UI about this step before it starts running, so it
    // can create a placeholder task immediately.
    emit(tracker.stepDetailEvent(stepId, title, description || title));
    tracker.start(stepId, title, description);
    emit(tracker.snapshot());

    const stepLog = (line: string): void => {
        tracker.log(stepId, line);
        const event = tracker.logEvent(stepId, line);
        if (event) emit(event);
    };

    try {
        const result = await body(stepLog);
        tracker.complete(stepId);
        emit(tracker.snapshot());
        return result;
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        stepLog(`❌ ${message}`);
        tracker.fail(stepId, message);
        emit(tracker.snapshot());
        throw err;
    }
}

/**
 * The set of step IDs the local bootstrap flow owns. Used to type
 * the local service so a typo at any call site is a compile error.
 */
export const LOCAL_STEP_IDS = [
    "provision_database",
    "ensure_empty",
    "run_migrations",
    "seed_initial_data",
    "register_node",
    "finalize",
] as const satisfies readonly SetupStepId[];

export type LocalStepId = (typeof LOCAL_STEP_IDS)[number];

/**
 * Set of step IDs the remote bootstrap flow owns. The remote flow
 * has more steps (mesh handshake, register node on the cluster, etc.)
 * — see `remote-initialization.service.ts`.
 */
export const REMOTE_STEP_IDS = [
    "reachability_check",
    "remote_auth",
    "provision_database",
    "ensure_empty",
    "run_migrations",
    "seed_initial_data",
    "mesh_handshake",
    "register_node",
    "finalize",
] as const satisfies readonly SetupStepId[];

export type RemoteStepId = (typeof REMOTE_STEP_IDS)[number];

/**
 * Replace the password in a postgres:// URL with `***` so it can be
 * safely logged. Returns the original string unchanged if the URL
 * can't be parsed.
 */
export function redactUrl(url: string): string {
    try {
        const parsed = new URL(url);
        if (parsed.password) parsed.password = "***";
        return parsed.toString();
    } catch {
        return url.replace(/\/\/[^@]+@/, "//***:***@");
    }
}

/**
 * Enumerate the migration files in a Drizzle migrations folder,
 * preferring the `_journal.json` order (which is the runtime order
 * Drizzle will apply them in) and falling back to a sorted
 * filesystem scan if the journal isn't found.
 */
export function listMigrationNames(migrationsFolder: string): string[] {
    try {
        const journalPath = join(migrationsFolder, "meta", "_journal.json");
        const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
            entries?: { tag?: string }[];
        };
        if (Array.isArray(journal.entries)) {
            return journal.entries
                .map((e) => e.tag)
                .filter((tag): tag is string => typeof tag === "string");
        }
    } catch {
        // fall through to filesystem scan
    }
    try {
        return readdirSync(migrationsFolder)
            .filter((f) => f.endsWith(".sql"))
            .sort();
    } catch {
        return [];
    }
}

/**
 * Slugify a string for use as an organization slug. Falls back to
 * `"organization"` if the result would be empty.
 */
export function slugify(value: string): string {
    return (
        value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "organization"
    );
}
