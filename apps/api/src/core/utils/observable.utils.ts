import type { Observable } from "rxjs";

function toError(value: unknown): Error {
    if (value instanceof Error) {
        return value;
    }
    if (typeof value === "string") {
        return new Error(value);
    }
    try {
        return new Error(JSON.stringify(value));
    } catch {
        return new Error("Unknown async iterable error");
    }
}

export function observableToAsyncIterable<T>(observable: Observable<T>): AsyncIterable<T> {
    const queue: T[] = [];
    let isCompleted = false;
    let thrownError: unknown = null;
    let resolvePending: (() => void) | null = null;

    const subscription = observable.subscribe({
        next: (value) => {
            queue.push(value);
            if (resolvePending) {
                resolvePending();
                resolvePending = null;
            }
        },
        error: (error: unknown) => {
            thrownError = error;
            if (resolvePending) {
                resolvePending();
                resolvePending = null;
            }
        },
        complete: () => {
            isCompleted = true;
            if (resolvePending) {
                resolvePending();
                resolvePending = null;
            }
        },
    });

    const waitForData = () =>
        new Promise<void>((resolve) => {
            resolvePending = resolve;
        });

    return {
        [Symbol.asyncIterator]() {
            return {
                next: async () => {
                    while (queue.length === 0 && !isCompleted && thrownError === null) {
                        await waitForData();
                    }

                    if (thrownError !== null) {
                        throw toError(thrownError);
                    }

                    if (queue.length > 0) {
                        const value = queue.shift();
                        return { value: value as T, done: false };
                    }

                    subscription.unsubscribe();
                    return { value: undefined, done: true };
                },
                return: async () => {
                    await Promise.resolve();
                    subscription.unsubscribe();
                    return { value: undefined, done: true };
                },
                throw: async (error: unknown) => {
                    await Promise.resolve();
                    subscription.unsubscribe();
                    throw toError(error);
                },
            };
        },
    };
}

