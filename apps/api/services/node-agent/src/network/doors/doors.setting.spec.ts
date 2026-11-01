import { describe, expect, it } from "vitest";

import { parseNodeDoorsSetting } from "./doors.setting";

const VALID = {
	image: "nginx:alpine",
	network: "deployer-platform",
	namePrefix: "deployer",
	entryPort: 80,
	upstream: "traefik",
	lanes: { local: { upstreamPort: 3000 }, private: { upstreamPort: 3001 }, lan: null },
	rescue: [{ host: "app.example.com", target: "deployer-api", port: 3000 }],
};

describe("parseNodeDoorsSetting", () => {
	it("accepts a valid setting", () => {
		const parsed = parseNodeDoorsSetting(JSON.stringify(VALID));
		expect(parsed.error).toBeNull();
		expect(parsed.setting?.namePrefix).toBe("deployer");
	});

	it("treats an absent setting as the normal first state", () => {
		expect(parseNodeDoorsSetting(undefined)).toEqual({ setting: null, error: null });
	});

	it("rejects a malformed setting with a reason", () => {
		const invalid = parseNodeDoorsSetting(JSON.stringify({ ...VALID, entryPort: 0 }));
		expect(invalid.setting).toBeNull();
		expect(invalid.error).not.toBeNull();
	});

	it("rejects a setting that is not JSON", () => {
		expect(parseNodeDoorsSetting("{not json").setting).toBeNull();
		expect(parseNodeDoorsSetting("{not json").error).not.toBeNull();
	});
});
