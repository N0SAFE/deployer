import { Observable } from "rxjs";

/**
 * Pulls an `AsyncIteratorObject` (decoded SSE) into an Observable, including
 * cancellation: unsubscribing calls `iterator.return()`, which aborts the HTTP
 * stream.
 */
export function asyncIteratorToObservable<T>(iterator: AsyncIterator<T>): Observable<T> {
  return new Observable<T>((subscriber) => {
    let closed = false;

    void (async () => {
      try {
        while (!closed) {
          const result = await iterator.next();
          if (result.done === true) break;
          subscriber.next(result.value);
        }
        if (!closed) subscriber.complete();
      } catch (error) {
        subscriber.error(error);
      }
    })();

    return () => {
      closed = true;
      void iterator.return?.(undefined);
    };
  });
}
