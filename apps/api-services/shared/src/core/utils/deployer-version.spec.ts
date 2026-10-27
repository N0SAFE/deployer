import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { DEPLOYER_VERSION } from "./deployer-version";

describe("DEPLOYER_VERSION", () => {
	it("is the version of the shared package, not the '0.0.0' fallback", () => {
		const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "package.json"), "utf-8")) as {
			version: string;
		};

		expect(pkg.version).not.toBe("0.0.0");
		expect(DEPLOYER_VERSION).toBe(pkg.version);
	});
});
