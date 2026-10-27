import { Test } from "@nestjs/testing";
import { Context, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { EffectRuntime } from "./effect-runtime";
import { EffectRuntimeModule } from "./effect-runtime.module";

class Greeter extends Context.Service<Greeter, { readonly greeting: string }>()(
  "test/Greeter",
) {}

describe("EffectRuntime", () => {
  it("exposes a provider whose Nest token is an Effect service key", async () => {
    const module = await Test.createTestingModule({
      imports: [EffectRuntimeModule],
      providers: [{ provide: Greeter, useValue: { greeting: "hello" } }],
    }).compile();

    const runtime = module.get(EffectRuntime);

    const greeting = await runtime.runPromise(
      Effect.gen(function* () {
        const greeter = yield* Greeter;
        return greeter.greeting;
      }),
    );

    expect(greeting).toBe("hello");
  });

  it("builds the context once and reuses it", async () => {
    const module = await Test.createTestingModule({
      imports: [EffectRuntimeModule],
      providers: [{ provide: Greeter, useValue: { greeting: "hello" } }],
    }).compile();

    const runtime = module.get(EffectRuntime);

    const first = await runtime.context();
    const second = await runtime.context();

    expect(first).toBe(second);
  });

  it("builds a contributed Layer over the discovered providers", async () => {
    class Pool extends Context.Service<Pool, { readonly size: number }>()(
      "test/Pool",
    ) {}

    class Bus extends Context.Service<Bus, { readonly pool: Pool }>()("test/Bus") {}

    const busLayer = Layer.effect(
      Bus,
      Effect.gen(function* () {
        const pool = yield* Pool;
        return { pool };
      }),
    );

    const module = await Test.createTestingModule({
      imports: [EffectRuntimeModule.forRoot({ layers: [busLayer] })],
      providers: [{ provide: Pool, useValue: { size: 3 } }],
    }).compile();

    const runtime = module.get(EffectRuntime);

    const size = await runtime.runPromise(
      Effect.gen(function* () {
        const bus = yield* Bus;
        return bus.pool.size;
      }),
    );

    expect(size).toBe(3);
  });

  it("does not build contributed layers, or cache anything, while providers are still being created", async () => {
    let built = 0;
    class Slow extends Context.Service<Slow, { readonly ready: true }>()("test/Slow") {}
    class Probe extends Context.Service<Probe, { readonly seen: boolean }>()("test/Probe") {}
    const counted = Layer.effect(
      Probe,
      Effect.sync(() => {
        built += 1;
        return { seen: true };
      }),
    );

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let earlyContext: Context.Context<unknown> | undefined;

    const module = await Test.createTestingModule({
      imports: [EffectRuntimeModule.forRoot({ layers: [counted] })],
      providers: [
        // A provider that is still being created when the host asks for the context ...
        {
          provide: Slow,
          useFactory: async () => {
            await gate;
            return { ready: true as const };
          },
        },
        // ... which is what the oRPC host does while it registers routes.
        {
          provide: "EARLY_ASK",
          inject: [EffectRuntime],
          useFactory: async (runtime: EffectRuntime) => {
            earlyContext = await runtime.context();
            release();
            return true;
          },
        },
      ],
    }).compile();

    // The early answer ran no contributed layer, so nothing could dereference a provider that was not there yet.
    expect(built).toBe(0);
    expect(earlyContext).toBeDefined();

    // Nothing was cached: the first call after startup builds the real context, once, and keeps it.
    const runtime = module.get(EffectRuntime);
    const first = await runtime.context();
    const second = await runtime.context();
    expect(built).toBe(1);
    expect(first).toBe(second);
    expect(first).not.toBe(earlyContext);
    expect(await runtime.runPromise(Effect.gen(function* () { return (yield* Slow).ready; }))).toBe(true);
  });
});
