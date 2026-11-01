import "reflect-metadata";

/** The two doors a mesh procedure can be served on. */
export type MeshDoor = "peer" | "node";

export type MeshProcedureMeta = {
	/** Which door serves it. */
	readonly door: MeshDoor;
	/** The router group, e.g. `directory`, `roster`, `node`. */
	readonly group: string;
	/** The key inside the group. Defaults to the method name. */
	readonly key?: string;
	/** The contract procedure. Validation and documentation only; nothing is executed with it. */
	readonly contract: unknown;
};

const MESH_TRANSPORT = Symbol.for("mesh:transport");
const MESH_PROCEDURES = Symbol.for("mesh:procedures");

/**
 * Marks a class as one the resolver owns: every `@MeshProcedure` method on it becomes a router entry.
 *
 * A marked class is a singleton provider, never a controller — mesh procedures have no HTTP route.
 */
export function MeshTransport(): ClassDecorator {
	return (target) => {
		Reflect.defineMetadata(MESH_TRANSPORT, true, target);
	};
}

/** Whether a class carries `@MeshTransport()`. Own metadata only: a subclass must declare itself. */
export function isMeshTransport(metatype: unknown): boolean {
	return typeof metatype === "function" && Reflect.getOwnMetadata(MESH_TRANSPORT, metatype) === true;
}

/**
 * Records one procedure on a method. Metadata only: the method runs when the router is built at bootstrap.
 *
 * The key defaults to the method name, so a method named like its contract procedure needs no key.
 */
export function MeshProcedure(meta: MeshProcedureMeta): MethodDecorator {
	return (target, propertyKey) => {
		const method = String(propertyKey);
		const defined =
			(Reflect.getOwnMetadata(MESH_PROCEDURES, target) as ReadonlyMap<string, MeshProcedureMeta> | undefined) ?? new Map();
		if (defined.has(method)) {
			throw new Error(`@MeshProcedure is applied twice to ${target.constructor.name}.${method}`);
		}
		const procedures = new Map(defined).set(method, { ...meta, key: meta.key ?? method });
		Reflect.defineMetadata(MESH_PROCEDURES, procedures, target);
	};
}

/** Sugar for a node-door procedure: `door: "node"`, `group: "node"`, key = method name. */
export function NodeProcedure(contract: unknown): MethodDecorator {
	return MeshProcedure({ door: "node", group: "node", contract });
}

/** Every procedure a class declared, keyed by method. Reads the prototype, where the method decorator stored it. */
export function meshProceduresOf(instance: object): ReadonlyMap<string, MeshProcedureMeta> {
	const prototype = Object.getPrototypeOf(instance) as object | null;
	if (prototype === null) return new Map();
	return (Reflect.getOwnMetadata(MESH_PROCEDURES, prototype) as ReadonlyMap<string, MeshProcedureMeta> | undefined) ?? new Map();
}
