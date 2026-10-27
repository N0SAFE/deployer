import { ValidationError } from "@deployer/errors";
import { describe, expect, it } from "vitest";

import { pushRules } from "./push.rules";

describe("pushRules", () => {
	describe("assertUsableEndpoint", () => {
		it("accepts an https endpoint such as a browser produces", () => {
			expect(() => { pushRules.assertUsableEndpoint("https://fcm.googleapis.com/fcm/send/abc"); }).not.toThrow();
		});

		// The server POSTs to this URL, so anything but https is a way to aim it at an
		// arbitrary or internal host.
		it.each([
			"http://fcm.googleapis.com/send",
			"ftp://example.com/x",
			"file:///etc/passwd",
			"//example.com",
			"https://",
			"https://exa mple.com",
			"",
		])("rejects %j", (endpoint) => {
			expect(() => { pushRules.assertUsableEndpoint(endpoint); }).toThrow(ValidationError);
		});
	});

	describe("assertUsableKey", () => {
		it("accepts base64url of at least the minimum length", () => {
			expect(() => { pushRules.assertUsableKey("a".repeat(22), "auth", 16); }).not.toThrow();
			expect(() => { pushRules.assertUsableKey("Ab-_9".repeat(5), "p256dh", 20); }).not.toThrow();
		});

		it("rejects a value that is too short", () => {
			expect(() => { pushRules.assertUsableKey("abc", "auth", 16); }).toThrow(ValidationError);
		});

		it.each(["has space aaaaaaaaaaaaaa", "plus+plus+plus+plus+", "slash/slash/slash/aa", "pad=pad=pad=pad=pad="])(
			"rejects %j, which is not base64url",
			(value) => {
				expect(() => { pushRules.assertUsableKey(value, "auth", 4); }).toThrow(ValidationError);
			},
		);

		it("names the offending field in the error path", () => {
			try {
				pushRules.assertUsableKey("", "p256dh", 10);
				expect.unreachable();
			} catch (error) {
				expect((error as ValidationError).message).toContain("p256dh");
			}
		});
	});

	describe("deliveryReport", () => {
		it("reports every device delivered when all are deliverable", () => {
			expect(pushRules.deliveryReport(3, 10)).toEqual({ success: 3, failed: 0, total: 3 });
		});

		it("bounds success by what is deliverable overall", () => {
			expect(pushRules.deliveryReport(3, 1)).toEqual({ success: 1, failed: 2, total: 3 });
		});

		it("reports nothing when the caller has no devices", () => {
			expect(pushRules.deliveryReport(0, 5)).toEqual({ success: 0, failed: 0, total: 0 });
		});

		it("reports every device failed when none is deliverable", () => {
			expect(pushRules.deliveryReport(2, 0)).toEqual({ success: 0, failed: 2, total: 2 });
		});
	});
});
