import { describe, expect, it } from "vitest";

import { credentialVerifier } from "./credential";

describe("credentialVerifier", () => {
  const verify = credentialVerifier("the-mesh-secret");

  it("accepts the secret", () => {
    expect(verify("the-mesh-secret")).toBe(true);
  });

  it.each([undefined, "", "the-mesh-secre", "the-mesh-secret!", "THE-MESH-SECRET"])("refuses %j", (presented) => {
    expect(verify(presented)).toBe(false);
  });
});
