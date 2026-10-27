import { describe, expect, it } from "vitest";

import { PLATFORM_API_BASE_NAME, platformApiServiceName } from "../platform-names";

describe("platformApiServiceName", () => {
    it("is the bare base name without a prefix", () => {
        expect(platformApiServiceName("")).toBe(PLATFORM_API_BASE_NAME);
        expect(platformApiServiceName(null)).toBe(PLATFORM_API_BASE_NAME);
        expect(platformApiServiceName(undefined)).toBe(PLATFORM_API_BASE_NAME);
    });

    it("appends the tenant prefix", () => {
        expect(platformApiServiceName("acme")).toBe(`${PLATFORM_API_BASE_NAME}-acme`);
    });
});
