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
});
