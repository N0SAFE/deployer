import { describe, expect, it, vi } from "vitest";

import { currentServiceAuth } from "./service-auth-context";
import { serviceAuthContextEdge } from "./service-auth-context.edge";

import type { INestApplication } from "@nestjs/common";
import type { Request, Response } from "express";

/** Mount the edge on a fake app and hand back the handler it registered. */
function handler() {
	let registered: ((req: Request, res: Response, next: () => void) => void) | undefined;
	serviceAuthContextEdge().mount({ use: (fn: typeof registered) => { registered = fn; } } as unknown as INestApplication);
	if (registered === undefined) throw new Error("the edge registered no handler");
	return registered;
}

const requestWith = (headers: Record<string, string | string[]>) => ({ headers }) as unknown as Request;

describe("serviceAuthContextEdge", () => {
	it("makes the caller's credentials visible to everything `next()` runs", () => {
		let seen: ReturnType<typeof currentServiceAuth> | undefined;
		handler()(requestWith({ cookie: "session=abc", authorization: "Bearer t", "x-api-key": "dk_1", "x-mesh-internal-key": "v2.k" }), {} as Response, () => { seen = currentServiceAuth(); });

		expect(seen).toEqual({ cookie: "session=abc", authorization: "Bearer t", apiKey: "dk_1", meshInternalKey: "v2.k" });
	});

	it("reads an API key from a `Bearer dk_…` authorization", () => {
		let seen: ReturnType<typeof currentServiceAuth> | undefined;
		handler()(requestWith({ authorization: "Bearer dk_xyz" }), {} as Response, () => { seen = currentServiceAuth(); });
		expect(seen?.apiKey).toBe("dk_xyz");
	});

	it("does not reject an anonymous request — it carries nothing", () => {
		const next = vi.fn(() => currentServiceAuth());
		handler()(requestWith({}), {} as Response, next);
		expect(next).toHaveBeenCalledOnce();
		expect(next.mock.results[0]?.value).toEqual({ cookie: undefined, authorization: undefined, apiKey: undefined, meshInternalKey: undefined });
	});

	it("leaves nothing behind outside the request", () => {
		handler()(requestWith({ cookie: "c" }), {} as Response, () => undefined);
		expect(currentServiceAuth()).toEqual({});
	});
});
