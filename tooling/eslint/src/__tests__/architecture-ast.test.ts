import { describe, expect, it } from "vitest";

import { arrayProperty, calleeName, entryName, staticNames } from "../rules/architecture/ast";
import type { AstNode } from "../rules/architecture/ast";
import { parseOptions } from "../rules/architecture/facts-client";
import { factsSchema } from "../rules/architecture/facts-schema";

const id = (name: string): AstNode => ({ type: "Identifier", name });
const provide = (name: string): AstNode => ({
	type: "ObjectExpression",
	properties: [{ type: "Property", key: id("provide"), value: id(name) }],
});
const array = (key: string, elements: readonly (AstNode | null)[]): AstNode => ({
	type: "Property",
	key: id(key),
	value: { type: "ArrayExpression", elements },
});
const metadata = (...properties: AstNode[]): AstNode => ({ type: "ObjectExpression", properties });

describe("entryName", () => {
	it("reads an identifier and a `{ provide: X }` entry", () => {
		expect(entryName(id("A"))).toBe("A");
		expect(entryName(provide("B"))).toBe("B");
	});
	it("is undefined for an entry it cannot name", () => {
		expect(entryName({ type: "CallExpression" })).toBeUndefined();
	});
});

describe("calleeName", () => {
	it("reads `f()` and `x.f()`", () => {
		expect(calleeName({ type: "CallExpression", callee: id("declareModule") })).toBe("declareModule");
		expect(calleeName({ type: "CallExpression", callee: { type: "MemberExpression", property: id("createModuleContext") } })).toBe("createModuleContext");
	});
});

describe("arrayProperty", () => {
	it("returns the elements, dropping holes", () => {
		expect(arrayProperty(metadata(array("providers", [id("A"), null, id("B")])), "providers")).toHaveLength(2);
	});
	it("is empty when the property is absent or not an array literal", () => {
		expect(arrayProperty(metadata(), "providers")).toEqual([]);
		expect(arrayProperty(metadata({ type: "Property", key: id("providers"), value: id("repositories") }), "providers")).toEqual([]);
		expect(arrayProperty(undefined, "providers")).toEqual([]);
	});
});

describe("staticNames — judge only what the syntax shows in full", () => {
	it("lists class tokens and `{ provide }` entries", () => {
		expect(staticNames(metadata(array("providers", [id("A"), provide("B")])), "providers")).toEqual(new Set(["A", "B"]));
	});
	it("is an empty set when the property is absent (a module with no providers)", () => {
		expect(staticNames(metadata(), "providers")).toEqual(new Set());
	});
	it("is null for a variable, a spread, a factory call or a hole", () => {
		expect(staticNames(metadata({ type: "Property", key: id("providers"), value: id("repositories") }), "providers")).toBeNull();
		expect(staticNames(metadata(array("providers", [{ type: "SpreadElement" }])), "providers")).toBeNull();
		expect(staticNames(metadata(array("providers", [{ type: "CallExpression", callee: id("effectHostProvider") }])), "providers")).toBeNull();
		expect(staticNames(metadata(array("providers", [null])), "providers")).toBeNull();
	});
	it("is null for a camelCase provider value — it may provide any token", () => {
		expect(staticNames(metadata(array("providers", [id("apiEnvironmentProvider")])), "providers")).toBeNull();
	});
	it("takes `Module.forRoot(...)` in `imports` as the module", () => {
		const forRoot: AstNode = { type: "CallExpression", callee: { type: "MemberExpression", object: id("ConfigModule"), property: id("forRoot") } };
		expect(staticNames(metadata(array("imports", [forRoot])), "imports")).toEqual(new Set(["ConfigModule"]));
	});
});

describe("parseOptions", () => {
	it("accepts the documented keys and nothing else", () => {
		expect(parseOptions({ root: "/x", globs: ["a/**"] })).toEqual({ root: "/x", globs: ["a/**"] });
		expect(parseOptions(undefined)).toEqual({});
		expect(() => parseOptions({ glob: ["typo"] })).toThrow(/invalid rule options/);
		expect(() => parseOptions({ globs: "not-an-array" })).toThrow(/globs/);
	});
});

describe("factsSchema — the contract with the facts process", () => {
	const valid = { files: {}, globals: [], sites: {}, errors: {} };
	it("accepts a well-formed document", () => {
		expect(factsSchema.safeParse(valid).success).toBe(true);
	});
	it("rejects a missing key and a malformed position, naming the field", () => {
		expect(factsSchema.safeParse({ files: {}, globals: [], sites: {} }).success).toBe(false);
		const bad = { ...valid, files: { "/a.ts": { bare: [], calls: [{ start: { line: 0, column: 0 }, module: "M", pairs: [] }] } } };
		const result = factsSchema.safeParse(bad);
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path.join(".")).toContain("line");
	});
});
