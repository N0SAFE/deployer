import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import { tolerateMissingScanTable } from "./tolerate-missing-scan-table";

describe("tolerateMissingScanTable", () => {
  it("replaces a missing-table failure with the fallback", async () => {
    const result = await Effect.runPromise(
      Effect.fail({ code: "42P01" }).pipe(tolerateMissingScanTable("none")),
    );
    expect(result).toBe("none");
  });

  it("looks through nested causes", async () => {
    const result = await Effect.runPromise(
      Effect.fail(new Error("db", { cause: { code: "42P01" } })).pipe(tolerateMissingScanTable(0)),
    );
    expect(result).toBe(0);
  });

  it("lets every other failure through and keeps successes", async () => {
    const failure = await Effect.runPromiseExit(Effect.fail(new Error("boom")).pipe(tolerateMissingScanTable(0)));
    expect(Exit.isFailure(failure)).toBe(true);
    expect(await Effect.runPromise(Effect.succeed(5).pipe(tolerateMissingScanTable(0)))).toBe(5);
  });
});
