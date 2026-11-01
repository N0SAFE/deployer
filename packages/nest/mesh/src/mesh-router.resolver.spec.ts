import { describe, expect, it } from "vitest";

import { MeshProcedure, MeshTransport, NodeProcedure } from "./mesh-procedure.decorator";
import { MeshRouterResolver } from "./mesh-router.resolver";

@MeshTransport()
class DirectoryFakes {
	calls = 0;

	@MeshProcedure({ door: "peer", group: "directory", contract: "directory.list" })
	list() {
		this.calls += 1;
		return { procedure: "directory.list" };
	}
}

@MeshTransport()
class NodeFakes {
	@NodeProcedure("node.state")
	state() {
		return { procedure: "node.state" };
	}
}

class UnmarkedFakes {
	@MeshProcedure({ door: "peer", group: "directory", contract: "directory.list" })
	list() {
		return { procedure: "unmarked" };
	}
}

@MeshTransport()
class RequestScopedFakes {
	@MeshProcedure({ door: "peer", group: "directory", contract: "directory.list" })
	list() {
		return { procedure: "request-scoped" };
	}
}

const CONTRACT: Record<string, Record<string, unknown>> = { directory: { list: {} }, node: { state: {} } };

type FakeClass = new () => object;

/**
 * A resolver over fixed discovery wrappers: no Nest container, the same API the discovery service exposes. Mesh
 * procedure classes are controllers, so the controller list is where they are read; the provider list only proves the
 * "must be a controller" rule.
 */
function resolverOver(
	entries: readonly { metatype: FakeClass; singleton?: boolean; instance?: object | null }[],
	contract: Record<string, Record<string, unknown>> = CONTRACT,
	providers: readonly FakeClass[] = [],
	serviceProcedures?: readonly string[],
) {
	const controllers = entries.map(({ metatype, singleton = true, instance }) => ({
		metatype,
		isDependencyTreeStatic: () => singleton,
		instance: instance === undefined ? new metatype() : instance,
	}));
	return new MeshRouterResolver(
		{
			getProviders: () => providers.map((metatype) => ({ metatype })),
			getControllers: () => controllers,
		} as never,
		{ contract, serviceProcedures },
	);
}

describe("MeshRouterResolver", () => {
	it("builds both routers from two fake controllers and calls each method once", () => {
		const directory = new DirectoryFakes();
		const resolver = resolverOver([
			{ metatype: DirectoryFakes, instance: directory },
			{ metatype: NodeFakes, instance: new NodeFakes() },
		]);

		const { peer, node } = resolver.resolve();

		expect(peer).toEqual({ directory: { list: { procedure: "directory.list" } } });
		expect(node).toEqual({
			directory: { list: { procedure: "directory.list" } },
			node: { state: { procedure: "node.state" } },
		});
		expect(directory.calls).toBe(1);
	});

	it("ignores an unmarked controller", () => {
		const { peer } = resolverOver([{ metatype: UnmarkedFakes }], {}).resolve();

		expect(peer).toEqual({});
	});

	it("refuses a class declared as a provider instead of a controller", () => {
		const resolver = resolverOver([], {}, [DirectoryFakes]);

		expect(() => resolver.resolve()).toThrow(/DirectoryFakes is decorated with @MeshTransport\(\) but is a provider/);
	});

	it("refuses a key served twice", () => {
		@MeshTransport()
		class Duplicate {
			@MeshProcedure({ door: "peer", group: "directory", contract: "directory.list", key: "list" })
			other() {
				return { procedure: "duplicate" };
			}
		}
		const colliding = resolverOver(
			[{ metatype: Duplicate }, { metatype: DirectoryFakes }],
			{ directory: { list: {} } },
		);

		expect(() => colliding.resolve()).toThrow(/peer\/directory\/list twice: check DirectoryFakes\.list/);
	});

	it("reads a class registered twice only once", () => {
		const resolver = resolverOver([{ metatype: DirectoryFakes }, { metatype: DirectoryFakes }], {
			directory: { list: {} },
		});

		expect(Object.keys(resolver.resolve().peer.directory ?? {})).toEqual(["list"]);
	});

	it("refuses a non-singleton controller by name", () => {
		const resolver = resolverOver([{ metatype: RequestScopedFakes, singleton: false }]);

		expect(() => resolver.resolve()).toThrow(/RequestScopedFakes is decorated with @MeshTransport\(\) but is not a singleton controller/);
	});

	it("refuses a controller Nest did not instantiate", () => {
		const resolver = resolverOver([{ metatype: RequestScopedFakes, instance: null }]);

		expect(() => resolver.resolve()).toThrow(/RequestScopedFakes .* not a singleton controller/);
	});

	it("fails the boot when the contract has a procedure no controller declares", () => {
		const resolver = resolverOver([{ metatype: DirectoryFakes }], {
			directory: { list: {} },
			node: { state: {} },
		});

		expect(() => resolver.resolve()).toThrow(/node\.state/);
	});

	it("serves only the allowlisted procedures on the service door, and everything on the admin door", () => {
		const resolver = resolverOver(
			[
				{ metatype: DirectoryFakes, instance: new DirectoryFakes() },
				{ metatype: NodeFakes, instance: new NodeFakes() },
			],
			CONTRACT,
			[],
			["directory.list"],
		);

		const { peer, node, admin } = resolver.resolve();

		expect(peer).toEqual({ directory: { list: { procedure: "directory.list" } } });
		expect(node).toEqual({ directory: { list: { procedure: "directory.list" } } });
		expect(admin).toEqual({
			directory: { list: { procedure: "directory.list" } },
			node: { state: { procedure: "node.state" } },
		});
	});

	it("serves the full local router on the service door when no allowlist is given", () => {
		const resolver = resolverOver([
			{ metatype: DirectoryFakes, instance: new DirectoryFakes() },
			{ metatype: NodeFakes, instance: new NodeFakes() },
		]);

		const { node, admin } = resolver.resolve();

		expect(node).toEqual(admin);
	});

	it("fails the boot when the allowlist names a procedure nothing serves", () => {
		const resolver = resolverOver(
			[{ metatype: DirectoryFakes, instance: new DirectoryFakes() }],
			{ directory: { list: {} } },
			[],
			["directory.missing"],
		);

		expect(() => resolver.resolve()).toThrow(/directory.missing/);
	});
});
