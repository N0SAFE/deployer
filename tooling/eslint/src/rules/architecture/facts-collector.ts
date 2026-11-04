/**
 * Module-graph facts, computed with the TypeScript 7.1 programmatic API.
 *
 * `bun lint` and the ESLint CLI hand a rule no type checker the rule can trust (`parserServices.program` is `null` under
 * Bun, and a `typescript-eslint` program would be TS6). So the types are computed HERE, once, in their own process
 * (`architecture-facts`), in ONE snapshot that opens every module file; the rules only look the result up.
 *
 * The async client is used on purpose: `typescript/sync` reads a Node-only handle (`stdout._handle.fd`) and fails under Bun.
 *
 * Nothing here may fail silently. A file the gate cannot analyse is recorded in `errors`, and a rule reports it — a gate that
 * skips a file reads as a clean file.
 */
import { globSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

import { API, SymbolFlags, TypeFlags } from "typescript-7-1/async";
import type { Checker, Project, Symbol as TsSymbol, Type } from "typescript-7-1/async";
import { SyntaxKind } from "typescript-7-1/ast";
import type { CallExpression, ClassDeclaration, Identifier, Node, ObjectLiteralExpression } from "typescript-7-1/ast";
import {
	isArrayLiteralExpression,
	isCallExpression,
	isClassDeclaration,
	isDecorator,
	isIdentifier,
	isMethodDeclaration,
	isObjectLiteralExpression,
	isPropertyAccessExpression,
	isPropertyAssignment,
	isSpreadElement,
	isStringLiteral,
	isVariableDeclaration,
} from "typescript-7-1/ast/is";

import type { Facts, FileFacts, Position, Site } from "./facts-schema";

const WRAPPER_CALLS = new Set(["createModuleContext", "createGlobalModule", "declareModule"]);
const DYNAMIC_FACTORY = /^(forRoot|forRootAsync|register|registerAsync)$/;
const NO_TRUNCATION = 1;
const CONCURRENCY = 8;
const SKIPPED = /(^|\/)(node_modules|dist|e2e)\//;
const SPEC = /\.(spec|test)\.ts$/;
const WRAPPER_TEXT = /createModuleContext\(|createGlobalModule\(|declareModule\(|@Module\(/;

// ── positions ────────────────────────────────────────────────────────────────

/** Offsets of every line start, with the same line breaks ESLint uses (`\n`, `\r\n`, `\r`, U+2028, U+2029). */
function lineStarts(text: string): number[] {
	const starts = [0];
	for (let index = 0; index < text.length; index++) {
		const code = text.charCodeAt(index);
		if (code === 13 && text.charCodeAt(index + 1) === 10) index++;
		else if (code !== 10 && code !== 13 && code !== 0x2028 && code !== 0x2029) continue;
		starts.push(index + 1);
	}
	return starts;
}

class Texts {
	private readonly starts = new Map<string, number[]>();

	/** The position of a UTF-16 offset in `file`, read from disk — the same text the compiler read. */
	positionAt(file: string, offset: number): Position {
		let starts = this.starts.get(file);
		if (starts === undefined) {
			starts = lineStarts(readFileSync(file, "utf8"));
			this.starts.set(file, starts);
		}
		let low = 0;
		let high = starts.length - 1;
		while (low < high) {
			const middle = (low + high + 1) >> 1;
			if (starts[middle] <= offset) low = middle;
			else high = middle - 1;
		}
		return { line: low + 1, column: offset - starts[low] };
	}
}

// ── syntax helpers ───────────────────────────────────────────────────────────

function walk(node: Node, visit: (node: Node) => void): void {
	visit(node);
	node.forEachChild((child) => walk(child, visit));
}

function propertyName(property: Node): string | undefined {
	if (!isPropertyAssignment(property)) return undefined;
	return isIdentifier(property.name) || isStringLiteral(property.name) ? property.name.text : undefined;
}

function property(literal: ObjectLiteralExpression, name: string) {
	return literal.properties.find((candidate) => propertyName(candidate) === name);
}

function calleeName(call: CallExpression): string | undefined {
	const callee = call.expression;
	if (isIdentifier(callee)) return callee.text;
	return isPropertyAccessExpression(callee) ? callee.name.text : undefined;
}

/** The module a call declares is named by its enclosing `class X extends createModuleContext(…)` or `const X = …`. */
function enclosingName(node: Node): string {
	for (let current: Node | undefined = node.parent; current !== undefined; current = current.parent) {
		if (isClassDeclaration(current) && current.name !== undefined) return current.name.text;
		if (isVariableDeclaration(current) && isIdentifier(current.name)) return current.name.text;
	}
	return "module";
}

/** Class names handed to `declareModule` as `declareModule(X, …)` or `declareModule({ module: X, … }, …)`. */
function declaredClassNames(calls: readonly CallExpression[]): Set<string> {
	const names = new Set<string>();
	for (const call of calls) {
		if (calleeName(call) !== "declareModule") continue;
		const first = call.arguments[0];
		if (first === undefined) continue;
		if (isIdentifier(first)) names.add(first.text);
		else if (isObjectLiteralExpression(first)) {
			const module = property(first, "module");
			if (module !== undefined && isPropertyAssignment(module) && isIdentifier(module.initializer)) names.add(module.initializer.text);
		}
	}
	return names;
}

/** A `@Module` class with a static `forRoot`/`register` is a factory: the declaration belongs on its result, not the class. */
function isModuleClass(cls: ClassDeclaration): boolean {
	const decorated = (cls.modifiers ?? []).some(
		(modifier) =>
			isDecorator(modifier) &&
			isCallExpression(modifier.expression) &&
			isIdentifier(modifier.expression.expression) &&
			modifier.expression.expression.text === "Module",
	);
	if (!decorated) return false;
	return !cls.members.some(
		(member) =>
			isMethodDeclaration(member) &&
			(member.modifiers ?? []).some((modifier) => modifier.kind === SyntaxKind.StaticKeyword) &&
			isIdentifier(member.name) &&
			DYNAMIC_FACTORY.test(member.name.text),
	);
}

/** The names a `createGlobalModule` / `declareModule(…, { global: true })` call exports. */
function globalExports(call: CallExpression): string[] {
	const name = calleeName(call);
	if (name !== "createGlobalModule") {
		if (name !== "declareModule") return [];
		const options = call.arguments[1];
		const flag = options !== undefined && isObjectLiteralExpression(options) ? property(options, "global") : undefined;
		if (flag === undefined || !isPropertyAssignment(flag) || flag.initializer.kind !== SyntaxKind.TrueKeyword) return [];
	}
	// Two spellings: `createGlobalModule({ exports })` / `declareModule({ module, exports }, { global })`, and
	// `declareModule(Class, { provides, exports, global })`, where the tokens live in the second argument.
	const names: string[] = [];
	for (const source of [call.arguments[0], call.arguments[1]]) {
		if (source === undefined || !isObjectLiteralExpression(source)) continue;
		for (const key of ["exports", "provides"]) {
			const entry = property(source, key);
			if (entry === undefined || !isPropertyAssignment(entry) || !isArrayLiteralExpression(entry.initializer)) continue;
			for (const element of entry.initializer.elements) {
				if (isIdentifier(element)) names.push(element.text);
				else if (isObjectLiteralExpression(element)) {
					const provide = property(element, "provide");
					if (provide !== undefined && isPropertyAssignment(provide) && isIdentifier(provide.initializer)) names.push(provide.initializer.text);
				}
			}
		}
	}
	return names;
}

/** `providers` / `controllers` entries by token name → the identifier that names it (`X` or `{ provide: X }`). */
function entryNodes(call: CallExpression): Map<string, Identifier> {
	const nodes = new Map<string, Identifier>();
	const metadata = call.arguments[0];
	if (metadata === undefined || !isObjectLiteralExpression(metadata)) return nodes;
	for (const key of ["providers", "controllers"]) {
		const entry = property(metadata, key);
		if (entry === undefined || !isPropertyAssignment(entry) || !isArrayLiteralExpression(entry.initializer)) continue;
		for (const element of entry.initializer.elements) {
			if (isSpreadElement(element)) continue;
			let named: Node | undefined = element;
			if (isObjectLiteralExpression(element)) {
				const provide = property(element, "provide");
				named = provide !== undefined && isPropertyAssignment(provide) ? provide.initializer : undefined;
			}
			if (named !== undefined && isIdentifier(named)) nodes.set(named.text, named);
		}
	}
	return nodes;
}

// ── type reading ─────────────────────────────────────────────────────────────

interface Pair {
	readonly owner: string;
	readonly missing: string;
	/** The missing service's symbol, so a same-named class elsewhere is not mistaken for it. */
	readonly missingSymbol: number | undefined;
}

async function findProperty(checker: Checker, type: Type, needle: string): Promise<TsSymbol | undefined> {
	return (await checker.getPropertiesOfType(type)).find((symbol) => symbol.name.includes(needle));
}

async function resolveAlias(checker: Checker, symbol: TsSymbol | undefined): Promise<TsSymbol | undefined> {
	if (symbol === undefined || (symbol.flags & SymbolFlags.Alias) === 0) return symbol;
	return checker.getAliasedSymbol(symbol);
}

/** One entry per constituent of a union (`A | B`): each service is its own finding. */
async function constituents(type: Type): Promise<Type[]> {
	return type.isUnionType() ? [...(await type.getTypes())] : [type];
}

async function pairsOf(checker: Checker, unmet: Type): Promise<Pair[]> {
	const pairs: Pair[] = [];
	for (const member of await constituents(unmet)) {
		// `getTypeArguments` panics the Go side on a non-reference member (a generic parameter in the library's own file).
		if (!member.isTypeReference()) continue;
		const [owners, missings] = await Promise.all(
			(await checker.getTypeArguments(member)).slice(0, 2).map((argument) => constituents(argument)),
		);
		if (owners === undefined || missings === undefined) continue;
		for (const owner of owners) {
			for (const missing of missings) {
				pairs.push({
					owner: (await checker.typeToString(owner, undefined, NO_TRUNCATION)).replace(/^typeof /, ""),
					missing: await checker.typeToString(missing, undefined, NO_TRUNCATION),
					missingSymbol: (await missing.getSymbol())?.id,
				});
			}
		}
	}
	return pairs;
}

// ── per-file facts ───────────────────────────────────────────────────────────

interface Context {
	readonly project: Project;
	readonly checker: Checker;
	readonly texts: Texts;
}

/**
 * Where `owner` USES the missing service: every reference to it inside the owner's own declaration (`yield* ReplicaStore`
 * in the service body), matched by SYMBOL so a same-named class elsewhere is not reported.
 */
async function usageSites(context: Context, identifier: Identifier, pair: Pair): Promise<{ file: string; start: Position; end: Position }[]> {
	const { checker, project, texts } = context;
	const symbol = await resolveAlias(checker, await checker.getSymbolAtLocation(identifier));
	const handle = symbol?.valueDeclaration ?? symbol?.declarations[0];
	const declaration = handle === undefined ? undefined : await handle.resolve(project);
	if (declaration === undefined) return [];

	const file = realpathSync(declaration.getSourceFile().fileName);
	const candidates: Identifier[] = [];
	walk(declaration, (node) => {
		if (isIdentifier(node) && node.text === pair.missing) candidates.push(node);
	});

	const sites: { file: string; start: Position; end: Position }[] = [];
	for (const node of candidates) {
		if (pair.missingSymbol !== undefined) {
			const used = await resolveAlias(checker, await checker.getSymbolAtLocation(node));
			if (used !== undefined && used.id !== pair.missingSymbol) continue;
		}
		sites.push({ file, start: texts.positionAt(file, node.getStart()), end: texts.positionAt(file, node.getEnd()) });
	}
	return sites;
}

/** A site plus the file it is in: the file is the key it is stored under, not part of the serialised site. */
type SiteInFile = Site & { readonly file: string };

interface FileResult {
	readonly facts: FileFacts;
	readonly globals: string[];
	readonly sites: SiteInFile[];
}

async function analyse(file: string, context: Context): Promise<FileResult> {
	const { checker, project, texts } = context;
	const source = await project.program.getSourceFile(file);
	if (source === undefined) throw new Error("the compiler returned no source file for it");

	const classes: ClassDeclaration[] = [];
	const calls: CallExpression[] = [];
	walk(source, (node) => {
		if (isClassDeclaration(node) && node.name !== undefined && isModuleClass(node)) classes.push(node);
		if (isCallExpression(node) && WRAPPER_CALLS.has(calleeName(node) ?? "")) calls.push(node);
	});

	// Handed to `declareModule`: the wrapper carries the phantom types, the class is an implementation detail.
	const declared = declaredClassNames(calls);
	const bare: string[] = [];
	for (const cls of classes) {
		const name = (cls.name as Identifier).text;
		if (declared.has(name)) continue;
		const symbol = await checker.getSymbolAtLocation(cls.name as Identifier);
		const staticSide = symbol === undefined ? undefined : await checker.getTypeOfSymbol(symbol);
		const instance = await checker.getTypeAtLocation(cls);
		const carries =
			(staticSide !== undefined && (await findProperty(checker, staticSide, "ExportsOf")) !== undefined) ||
			(instance !== undefined && (await findProperty(checker, instance, "ExportsOf")) !== undefined);
		if (!carries) bare.push(name);
	}

	const callFacts: FileFacts["calls"] = [];
	const globals: string[] = [];
	const sites: SiteInFile[] = [];
	for (const call of calls) {
		globals.push(...globalExports(call));
		const module = enclosingName(call);
		const start = texts.positionAt(file, call.getStart());

		// EVERY wrapper call is recorded, with `pairs: []` when nothing is unmet, so a rule can tell "analysed, clean" from
		// "never analysed" — the second is an error, not a pass.
		const type = await checker.getTypeAtLocation(call);
		const unmetSymbol = type === undefined ? undefined : await findProperty(checker, type, "UnmetRequirementsOf");
		const unmet = unmetSymbol === undefined ? undefined : await checker.getTypeOfSymbolAtLocation(unmetSymbol, call);
		if (unmet === undefined || (unmet.flags & TypeFlags.Never) !== 0) {
			callFacts.push({ start, module, pairs: [] });
			continue;
		}
		const pairs = await pairsOf(checker, unmet);
		callFacts.push({ start, module, pairs: pairs.map((pair) => [pair.owner, pair.missing]) });

		// The same gap at the code that needs the service. Scan the owner AND every provider of the module: a service the module
		// provides can be the one whose code needs `missing` (`yield* ReplicaStore` in `MeshDirectory`) while the controller
		// only reaches it transitively.
		const nodes = entryNodes(call);
		for (const pair of pairs) {
			for (const name of new Set([pair.owner, ...nodes.keys()])) {
				const identifier = nodes.get(name);
				if (identifier === undefined) continue;
				for (const site of await usageSites(context, identifier, pair)) {
					sites.push({ ...site, owner: name, missing: pair.missing, module, moduleFile: file });
				}
			}
		}
	}
	return { facts: { bare, calls: callFacts }, globals, sites };
}

// ── scope ────────────────────────────────────────────────────────────────────

/** Every module file, plus any non-`.module.ts` file that declares a module inline. Real paths, so symlinks cannot split a file in two. */
export function moduleFiles(root: string, globs: readonly string[]): string[] {
	const files = new Set<string>();
	for (const pattern of globs) {
		for (const file of globSync(pattern, { cwd: root })) {
			if (SKIPPED.test(file) || SPEC.test(file)) continue;
			const absolute = resolve(root, file);
			if (!file.endsWith(".module.ts") && !WRAPPER_TEXT.test(readFileSync(absolute, "utf8"))) continue;
			files.add(realpathSync(absolute));
		}
	}
	return [...files];
}

export async function collectFacts(root: string, globs: readonly string[]): Promise<Facts> {
	const files = moduleFiles(root, globs);
	const result: Facts = { files: {}, globals: [], sites: {}, errors: {} };
	const globals = new Set<string>();
	const texts = new Texts();
	const fail = (file: string, message: string) => (result.errors[file] ??= []).push(message);

	const api = new API({ cwd: root });
	try {
		const snapshot = await api.createSnapshot({ openFiles: files });
		let next = 0;
		await Promise.all(
			Array.from({ length: CONCURRENCY }, async () => {
				while (next < files.length) {
					const file = files[next++];
					try {
						const project = await snapshot.getDefaultProjectForFile(file);
						if (project === undefined) {
							fail(file, "it is not part of any tsconfig project, so its types cannot be read. Add it to a tsconfig `include`.");
							continue;
						}
						const analysed = await analyse(file, { project, checker: project.checker, texts });
						analysed.globals.forEach((name) => globals.add(name));
						result.files[file] = analysed.facts;
						for (const site of analysed.sites) {
							const { file: siteFile, ...rest } = site;
							(result.sites[siteFile] ??= []).push(rest);
						}
					} catch (error) {
						fail(file, error instanceof Error ? (error.message.split("\n")[0] ?? error.message) : String(error));
					}
				}
			}),
		);
		result.globals = [...globals];
		await snapshot.dispose();
	} finally {
		await api.close();
	}
	return result;
}
