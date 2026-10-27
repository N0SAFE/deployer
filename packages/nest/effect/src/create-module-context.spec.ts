import { Context } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import { createModuleContext, EffectContextOf } from "./create-module-context";
import type { EffectContext } from "./orpc-effect-context";

class Database extends Context.Service<
	Database,
	{ readonly name: string }
>()("test/Database") {}

class Users extends Context.Service<
	Users,
	{ readonly all: () => readonly string[] }
>()("test/Users") {}

const Leaf = createModuleContext({
	providers: [{ provide: Users, useValue: { all: () => [] } }],
});

const Root = createModuleContext({
	imports: [Leaf],
	providers: [{ provide: Database, useValue: { name: "db" } }],
});

type ServicesOf<ContextType> =
	ContextType extends EffectContext<infer Services> ? Services : never;

type LeafServices = ServicesOf<(typeof Leaf)[typeof EffectContextOf]>;
type RootServices = ServicesOf<(typeof Root)[typeof EffectContextOf]>;

describe("createModuleContext", () => {
	it("applies the module metadata to the returned class", () => {
		expect(Reflect.getMetadata("imports", Root)).toEqual([Leaf]);
		expect(Reflect.getMetadata("providers", Leaf)).toHaveLength(1);
	});

	it("exposes an oRPC middleware under the context symbol", () => {
		expect(Leaf[EffectContextOf]).toHaveProperty("~orpc");
	});

	it("types the context from the module's own providers", () => {
		expectTypeOf<LeafServices>().toEqualTypeOf<Users>();
	});

	it("types the context from the imported modules plus its own providers", () => {
		expectTypeOf<RootServices>().toEqualTypeOf<Users | Database>();
	});
});
