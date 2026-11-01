/**
 * `declareModule` claim guard.
 *
 * The Effect-context and requirement types live in phantom symbol properties that `declareModule` intersects onto the
 * module. Two things erase them, both silently:
 *
 *  - a `forRoot(...): DynamicModule` annotation — the widened return type is a bare `DynamicModule`, so `ExportsOf` is
 *    gone and the import contributes `never` to the importer's context and to the requirement gate;
 *  - a claims object that names no `provides` and no `exports` — the module then declares nothing (and `{}` reads like
 *    an oversight rather than a decision).
 *
 * RULES:
 *  1. A function whose body calls `declareModule(...)` must not annotate its return as `DynamicModule`.
 *  2. Every `declareModule(...)` call passes a claims object naming `provides` and/or `exports` — pass
 *     `{ provides: [], exports: [] }` to say "nothing Effect-shaped crosses this boundary".
 */
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { relative, resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "..")
const SOURCES = ["apps", "packages"].map((dir) => resolve(ROOT, dir)).filter(existsSync)

function walk(dir: string, out: string[] = []): string[] {
	if (!existsSync(dir)) return out
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".turbo") continue
		const path = resolve(dir, entry.name)
		if (entry.isDirectory()) walk(path, out)
		else if (entry.isFile() && path.endsWith(".ts") && !path.includes(".spec.")) out.push(path)
	}
	return out
}

const lineOf = (source: string, index: number): number => source.slice(0, index).split("\n").length

/**
 * Comments blanked out, offsets preserved.
 *
 * Parsing brackets on the raw source is wrong the moment a comment mentions a parenthesis (the platform's comments
 * do), so the analysis runs on a copy where every comment character became a space.
 */
function blankComments(source: string): string {
	let out = ""
	let quote: string | null = null
	for (let i = 0; i < source.length; i += 1) {
		const char = source[i] ?? ""
		const next = source[i + 1] ?? ""
		if (quote !== null) {
			out += char
			if (char === "\\") {
				out += next
				i += 1
			} else if (char === quote) quote = null
			continue
		}
		if (char === '"' || char === "'" || char === "`") {
			quote = char
			out += char
			continue
		}
		if (char === "/" && next === "/") {
			while (i < source.length && source[i] !== "\n") {
				out += " "
				i += 1
			}
			out += "\n"
			continue
		}
		if (char === "/" && next === "*") {
			while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
				out += source[i] === "\n" ? "\n" : " "
				i += 1
			}
			out += "  "
			i += 1
			continue
		}
		out += char
	}
	return out
}

/** The index of the bracket that closes the one at `open`, skipping strings and template literals. */
function closeOf(source: string, open: number, opener: string, closer: string): number {
	let depth = 0
	let quote: string | null = null
	for (let i = open; i < source.length; i += 1) {
		const char = source[i]
		if (quote !== null) {
			if (char === "\\") i += 1
			else if (char === quote) quote = null
			continue
		}
		if (char === '"' || char === "'" || char === "`") quote = char
		else if (char === opener) depth += 1
		else if (char === closer) {
			depth -= 1
			if (depth === 0) return i
		}
	}
	return -1
}

/** Splits a call's argument list at top-level commas. */
function argsOf(source: string, open: number, close: number): string[] {
	const args: string[] = []
	let depth = 0
	let quote: string | null = null
	let current = ""
	for (let i = open + 1; i < close; i += 1) {
		const char = source[i]
		if (quote !== null) {
			current += char
			if (char === "\\") {
				current += source[i + 1] ?? ""
				i += 1
			} else if (char === quote) quote = null
			continue
		}
		if (char === '"' || char === "'" || char === "`") quote = char
		else if ("([{".includes(char)) depth += 1
		else if (")]}".includes(char)) depth -= 1
		else if (char === "," && depth === 0) {
			args.push(current)
			current = ""
			continue
		}
		current += char
	}
	args.push(current)
	return args
}

/** The signature between the enclosing function's start and its body's `{`. */
function signatureBefore(source: string, bodyOpen: number, from: number): string {
	return source.slice(Math.max(from, bodyOpen - 400), bodyOpen)
}

const problems: string[] = []

/** Every `Context.Service` tag in the tree: a plain `@Module` can only leak these. */
const tagNames = new Set<string>()
for (const file of SOURCES.flatMap((dir) => walk(dir))) {
	const source = blankComments(readFileSync(file, "utf8"))
	for (const match of source.matchAll(/class (\w+)\s+extends\s+Context\.Service</g)) tagNames.add(match[1] ?? "")
}

for (const file of SOURCES.flatMap((dir) => walk(dir))) {
	const source = blankComments(readFileSync(file, "utf8"))
	if (!source.includes("declareModule(")) continue
	const location = relative(ROOT, file)

	for (let at = source.indexOf("declareModule("); at !== -1; at = source.indexOf("declareModule(", at + 1)) {
		// `declareModule(${name})` inside a template string is a message, not a call.
		if (source[at - 1] === "$" || source[at - 1] === "`") continue
		const callClose = closeOf(source, at + "declareModule".length, "(", ")")
		if (callClose === -1) continue
		const args = argsOf(source, at + "declareModule".length, callClose)
		const claims = args[1]?.trim() ?? ""

		if (claims === "") {
			problems.push(`${location}:${String(lineOf(source, at))}  declareModule(...) without a claims object`)
			continue
		}
		if (!/\bprovides\s*:/.test(claims) && !/\bexports\s*:/.test(claims)) {
			problems.push(
				`${location}:${String(lineOf(source, at))}  claims name neither provides nor exports; pass { provides: [], exports: [] } if nothing crosses`,
			)
		}

		// The enclosing function's body: the nearest `{` whose closing brace contains the call.
		const bodyOpen = source.lastIndexOf("{", at)
		if (bodyOpen !== -1) {
			const signature = signatureBefore(source, bodyOpen, at - 4000)
			if (/\)\s*:\s*DynamicModule\s*$/.test(signature.trimEnd())) {
				problems.push(
					`${location}:${String(lineOf(source, bodyOpen))}  this function returns \`: DynamicModule\`, which erases the claims; drop the annotation and let declareModule() type the return`,
				)
			}
		}
	}
}

/**
 * Rule 3: a plain `@Module` that hands a tag across its boundary.
 *
 * `declareModule` is what attaches `ExportsOf`; without it the importing module sees `never`, so a tag listed in a plain
 * `@Module`'s `providers`/`exports` is invisible to the Effect types. `ConfigurableModuleClass` is exempt: it builds a
 * fresh dynamic module per `forRoot` call, so there is no class-level metadata to claim.
 */
for (const file of SOURCES.flatMap((dir) => walk(dir))) {
	const source = blankComments(readFileSync(file, "utf8"))
	if (!source.includes("@Module(") || source.includes("createModuleContext")) continue

	for (const match of source.matchAll(/@Module\(\{([\s\S]*?)\n\}\)\n(?:export )?class (\w+)/g)) {
		const [, options = "", name = ""] = match
		if (source.includes(`declareModule(${name}`)) continue
		// `ConfigurableModuleClass` builds a fresh dynamic module per `forRoot` call: nothing to claim on the class.
		const afterName = source.slice(match.index + match[0].length, match.index + match[0].length + 300)
		if (/extends\s+ConfigurableModuleClass/.test(afterName)) continue

		const crossing = [...(options.matchAll(/\b(\w+)\b/g) ?? [])]
			.map((token) => token[1] ?? "")
			.filter((token) => tagNames.has(token))
		const unique = [...new Set(crossing)]
		if (unique.length === 0) continue

		problems.push(
			`${relative(ROOT, file)}:${String(lineOf(source, match.index))}  \`${name}\` is a plain @Module that lists ${unique.join(", ")}; wrap it in declareModule(${name}, { provides, exports }) so importers see it`,
		)
	}
}

if (problems.length > 0) {
	console.error(`module declarations that do not reach the type layer (${String(problems.length)}):`)
	for (const problem of problems) console.error(`  ${problem}`)
	console.error(
		"Fix: `declareModule(metadata, { provides: [Tag], exports: [Tag] })`, no `: DynamicModule` return type, and no tag in a plain @Module.",
	)
	process.exit(1)
}

console.log("OK: every declareModule() call declares its claims, keeps them in its return type, and no plain @Module leaks a tag.")
