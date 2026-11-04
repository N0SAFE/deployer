/**
 * `module-context` — the module graph, gated where the TYPE FLOW is decided.
 *
 * ── WHY SYNTACTIC (AND NOT TYPE-AWARE) ──────────────────────────────────────
 * The type flow reads a module's exports through a phantom symbol (`ExportsOf`). A plain `@Module` has no such symbol, so
 * importing it contributes NOTHING: its providers are invisible to `createModuleContext`, `[UnmetRequirementsOf]` grows,
 * and the failure surfaces at the root as `Missing<[Controller, Service]>` — three files away from the import that caused
 * it. That decision is made by the SOURCE of the imported file (is it a wrapper?), not by its type, so a syntax rule can
 * answer it exactly.
 *
 * (A rule that reads `[UnmetRequirementsOf]` itself would need the TypeScript program. `bun lint` exposes parser services
 * with `program: null`, so that half cannot live here; the type-level root gate already refuses to start the app.)
 *
 * ── WHAT IT CHECKS ──────────────────────────────────────────────────────────
 * 1. every `imports` entry that resolves to a LOCAL file must be declared with `createModuleContext()`,
 *    `createGlobalModule()` or `declareModule(...)` — otherwise it is opaque;
 * 2. a plain module with no `providers` is allowed: there is no Effect service to lose, and wrapping it would be noise;
 * 3. every `exports` entry must name a token the same module provides — an export of something it does not provide is a
 *    claim the container cannot honour.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { Rule } from "eslint";

const WRAPPERS = ["createModuleContext(", "createGlobalModule(", "declareModule("];

/** Whether a file's source declares a module through one of the wrappers that carry the phantom types. */
function declaresWrapper(source: string): boolean {
	return WRAPPERS.some((wrapper) => source.includes(wrapper));
}

/** Whether a file's source lists providers — i.e. whether wrapping it would change the type flow. */
function declaresProviders(source: string): boolean {
	return /providers\s*:\s*\[[^\]]*\S/.test(source);
}

/** The local file an import specifier points at, or `undefined` for a package import. */
function localFile(specifier: string, from: string): string | undefined {
	if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return undefined;

	const base = specifier.startsWith("@/")
		? resolve(from, "src", specifier.slice(2))
		: resolve(from, specifier);

	for (const candidate of [`${base}.ts`, `${base}/index.ts`]) {
		try {
			readFileSync(candidate);
			return candidate;
		} catch {
			continue;
		}
	}
	return undefined;
}

/** Array literal property of a metadata object, if present. */
function arrayProperty(object: { readonly properties?: readonly { readonly key?: { readonly name?: string }; readonly value?: { readonly type?: string; readonly elements?: readonly unknown[] } }[] }, name: string): readonly unknown[] {
	for (const property of object.properties ?? []) {
		if (property.key?.name !== name) continue;
		return property.value?.type === "ArrayExpression" ? (property.value.elements ?? []) : [];
	}
	return [];
}

/** `{ provide: X }` → `X`, otherwise the identifier the entry names. */
function entryName(node: unknown): string | undefined {
	const entry = node as {
		readonly type?: string;
		readonly properties?: readonly { readonly key?: { readonly name?: string }; readonly value?: { readonly name?: string } }[];
		readonly name?: string;
	};

	if (entry.type === "ObjectExpression") {
		const provide = entry.properties?.find((p) => p.key?.name === "provide");
		return provide?.value?.name;
	}
	return entry.name;
}

export function createModuleContextRule(): Rule.RuleModule {
	return {
		meta: {
			type: "problem",
			docs: {
				description:
					"Require imported modules to carry the Effect phantom types, and exported tokens to be providers of the same module.",
			},
			schema: [],
			messages: {
				opaqueImport:
					"`{{name}}` is a plain `@Module`: it contributes no Effect services, so everything imported through it is invisible to `createModuleContext`. Wrap it with `createModuleContext()` / `createGlobalModule()` / `declareModule(..., { exports })`.",
				unknownExport:
					"`{{name}}` is exported but not provided by this module. An export must name one of `providers`, or the type flow and Nest's container disagree.",
			},
		},

		create(context) {
			const filename = context.filename;
			const from = dirname(filename);

			return {
				CallExpression(node) {
					const callee = node.callee;
					const name =
						callee.type === "Identifier"
							? callee.name
							: callee.type === "MemberExpression" && callee.property.type === "Identifier"
								? callee.property.name
								: undefined;

					if (name !== "createModuleContext" && name !== "createGlobalModule") return;

					const metadata = node.arguments[0] as
						| {
								readonly type?: string;
								readonly properties?: readonly {
									readonly key?: { readonly name?: string };
									readonly value?: { readonly type?: string; readonly elements?: readonly unknown[] };
								}[];
						  }
						| undefined;

					if (metadata?.type !== "ObjectExpression") return;

					const provided = new Set(arrayProperty(metadata, "providers").map(entryName));

					// 1. Imports must be wrappers, so their exports exist at the type level.
					const localImports = new Map<string, string | undefined>();
					for (const statement of (context.sourceCode.ast.body ?? []) as readonly unknown[]) {
						const declaration = statement as {
							readonly type?: string;
							readonly source?: { readonly value?: string };
							readonly specifiers?: readonly { readonly local?: { readonly name?: string } }[];
						};
						if (declaration.type !== "ImportDeclaration" || declaration.source?.value === undefined) continue;
						for (const specifier of declaration.specifiers ?? []) {
							if (specifier.local?.name !== undefined) {
								localImports.set(specifier.local.name, localFile(declaration.source.value, from));
							}
						}
					}

					for (const entry of arrayProperty(metadata, "imports")) {
						const importedName = entryName(entry);
						if (importedName === undefined) continue;

						const file = localImports.get(importedName);
						// A package import carries its own wrapper at its definition (`createGlobalModule`), and a call
						// (`forRoot()`) is a DynamicModule whose claims belong inside that call.
						if (file === undefined) continue;

						const source = readFileSync(file, "utf8");
						if (declaresWrapper(source)) continue;
						// A plain module that provides nothing has nothing to lose.
						if (!declaresProviders(source)) continue;

						context.report({ node: entry as never, messageId: "opaqueImport", data: { name: importedName } });
					}

					// 2. Exports must be provided here.
					for (const entry of arrayProperty(metadata, "exports")) {
						const exportedName = entryName(entry);
						if (exportedName === undefined) continue;
						// A module export (`RoleDomainModule`) re-exports that module's own exports; a bare export must be
						// a token this module provides.
						if (provided.has(exportedName) || localImports.has(exportedName)) continue;

						context.report({ node: entry as never, messageId: "unknownExport", data: { name: exportedName } });
					}
				},
			};
		},
	};
}
