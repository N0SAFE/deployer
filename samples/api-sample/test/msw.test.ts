import { isDefinedError, safe } from "@orpc/client";
import { setupServer } from "msw/node";
import { firstValueFrom, of, toArray } from "rxjs";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { createClient } from "../src/client";
import type { Planet } from "../src/contracts";
import { mock } from "../src/mock";

const earth: Planet = {
  id: "earth",
  name: "Earth",
  description: "Home",
  discoveredAt: new Date(0).toISOString(),
};

const server = setupServer(
  mock.planet.list.handler(() => [earth]),
  mock.planet.findById.error("NOT_FOUND", { data: { id: "nope" } }),
  mock.logs.stream.handler(() =>
    of({ seq: 1, at: new Date(0).toISOString(), message: "mocked" }),
  ),
);

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** No Nest, no port, no auth: only the contract and the real OpenAPI handler. */
const client = createClient({ url: "http://localhost:4000" });

it("serves a mocked procedure through the real handler", async () => {
  await expect(client.planet.list({ limit: 5 })).resolves.toEqual([earth]);
});

it("rejects with the contract's typed error", async () => {
  const [error, data] = await safe(client.planet.findById({ id: "nope" }));

  expect(data).toBeUndefined();
  expect(isDefinedError(error)).toBe(true);
  if (!isDefinedError(error)) return;
  expect(error.code).toBe("NOT_FOUND");
  expect(error.data).toEqual({ id: "nope" });
});

it("streams an Observable over SSE", async () => {
  const events = await firstValueFrom(client.logs.stream({ count: 1 }).pipe(toArray()));

  expect(events.map((event) => event.message)).toEqual(["mocked"]);
});
