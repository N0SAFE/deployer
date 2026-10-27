import { Effect } from "effect";
import { Observable, firstValueFrom, lastValueFrom, of, toArray } from "rxjs";
import { describe, expect, it } from "vitest";
import { logEventSchema } from "../src/contracts/stream.contract";
import { observable } from "../src/contracts/observable";
import { LogStreamServiceImpl } from "../src/modules/stream/services/log-stream.service";
import { observableToAsyncIterator } from "../src/orpc/observable-to-async-iterator";

describe("LogStreamService", () => {
  it("emits count events through the RxJS pipeline", async () => {
    const service = new LogStreamServiceImpl();
    const source = Effect.runSync(service.stream({ count: 3 }, { tickMs: 1 }));

    const events = await lastValueFrom(source.pipe(toArray()));

    expect(events.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(events[2]?.message).toBe("tick 3/3");
  });
});

describe("observable() contract schema", () => {
  it("rejects invalid stream events against the item schema", async () => {
    const schema = observable(logEventSchema);
    const result = await schema["~standard"].validate(of({ wrong: true }));

    expect("issues" in result).toBe(false);
    if ("issues" in result) return;

    await expect(firstValueFrom(result.value)).rejects.toThrow(/Invalid stream event/);
  });
});

describe("observableToAsyncIterator", () => {
  it("forwards events in order", async () => {
    const source = new Observable<number>((subscriber) => {
      subscriber.next(1);
      subscriber.next(2);
      subscriber.complete();
    });

    const iterator = observableToAsyncIterator(source);
    const events: number[] = [];
    for await (const value of iterator) events.push(value);

    expect(events).toEqual([1, 2]);
  });

  it("unsubscribes when the consumer stops early", async () => {
    let unsubscribed = false;

    const source = new Observable<number>((subscriber) => {
      subscriber.next(1);
      subscriber.next(2);
      return () => {
        unsubscribed = true;
      };
    });

    const iterator = observableToAsyncIterator(source);
    await expect(iterator.next()).resolves.toEqual({ value: 1, done: false });

    await iterator.return(undefined);
    expect(unsubscribed).toBe(true);
  });
});
