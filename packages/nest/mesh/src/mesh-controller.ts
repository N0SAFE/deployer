/**
 * Mesh procedures without decorators.
 *
 * A class extends `MeshController` and declares its procedures as data:
 *
 * ```ts
 * @Controller()
 * export class AccessProcedures extends MeshController {
 *   static readonly procedures = declareProcedures({
 *     verify: { door: "peer", group: "access", contract: access.verify },
 *   });
 *
 *   verify() {
 *     return procedure(access.verify).effect(function* ({ input }) { … });
 *   }
 * }
 * ```
 *
 * Why data and not decorators or class fields:
 *
 * - **It survives every transform.** The vitest pipeline compiles class fields differently from `bun`; a field-based
 *   declaration was present in one runtime and absent in the other (the resolver then saw an empty instance). A static
 *   literal is part of the class object in both.
 * - **The requirement gate sees the methods.** `createModuleContext` reads a controller's methods and takes the `R` of
 *   what they return; the declaration names those methods, so the gate audits every procedure like any other handler.
 * - **One place states the door.** `door`, `group` and the contract procedure sit next to each other, and the resolver
 *   fails the boot when a contract procedure is not declared.
 */

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

/** Every procedure a class declares, by method name. */
export type MeshProcedureDeclarations = Readonly<Record<string, MeshProcedureMeta>>;

/** Identity helper, for typing: `static readonly procedures = declareProcedures({ … })`. */
export function declareProcedures<D extends MeshProcedureDeclarations>(declarations: D): D {
	return declarations;
}

const MESH_CONTROLLER: symbol = Symbol.for("mesh:controller");

export abstract class MeshController {
	/**
	 * The procedures this class serves, declared as data so nothing depends on decorators, reflection or how a compiler
	 * emits class fields. Each key is a method on the instance the resolver calls once.
	 */
	static readonly procedures: MeshProcedureDeclarations = {};
	/**
	 * A global-symbol marker, not `instanceof`.
	 *
	 * The agent boots its module graph several times in one test process (and a package can be loaded twice through its
	 * ESM and CJS entries), which would make two `MeshController` classes that are not each other's prototype. A symbol
	 * from the global registry is the same key in every copy, and static inheritance carries it to subclasses.
	 */
	static readonly [MESH_CONTROLLER] = true;
}





/** Whether a class extends `MeshController`, by the global marker (see the base class). */
export function isMeshController(metatype: unknown): boolean {
	if (typeof metatype !== "function") return false;
	return (metatype as unknown as Record<symbol, unknown>)[MESH_CONTROLLER] === true;
}
