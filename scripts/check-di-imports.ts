/**
 * Fails when a Nest class's constructor injects a class that was imported with `import type`.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Nest resolves a constructor parameter from the type metadata the compiler emits
 * (`design:paramtypes`). `import type { Foo }` erases `Foo` at runtime, so the emitted metadata
 * holds `Object` (or `undefined`) and Nest dies at boot with
 * `Nest can't resolve dependencies of the X (?, Object, Object)`.
 *
 * It slipped through every test: the e2e boots the module through SWC, which keeps the reference,
 * while the images run `bun`, which does not. The BFF's `ScreenReadService` shipped like that and
 * the container exited on start. This check catches the whole class of bug statically, in a second,
 * with no Docker and no database.
 *
 * A parameter that carries an explicit `@Inject(TOKEN)` is exempt: its type is documentation, the
 * token is what Nest reads, so a type-only import there is correct.
 *
 * Usage: `bun scripts/check-di-imports.ts`
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const SCAN = ["apps/api", "apps/setup/src"]
const SKIP = new Set(["node_modules", "dist", ".turbo", ".next"])

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		if (SKIP.has(entry)) continue
		const path = join(dir, entry)
		const stat = statSync(path)
		if (stat.isDirectory()) walk(path, out)
		else if (path.endsWith(".ts") && !path.endsWith(".spec.ts") && !path.endsWith(".d.ts")) out.push(path)
	}
	return out
}

/** Names imported type-only: `import type { A, B }` and `import { type A }`. */
function typeOnlyImports(source: string): Set<string> {
	const names = new Set<string>()
	for (const match of source.matchAll(/import\s+type\s*\{([^}]*)\}\s*from/g)) {
		for (const item of (match[1] ?? "").split(",")) names.add(localName(item))
	}
	for (const match of source.matchAll(/import\s+(?:\w+\s*,\s*)?\{([^}]*)\}\s*from/g)) {
		for (const item of (match[1] ?? "").split(",")) {
			if (/^\s*type\s+/.test(item)) names.add(localName(item.replace(/^\s*type\s+/, "")))
		}
	}
	names.delete("")
	return names
}

function localName(item: string): string {
	const parts = item.trim().split(/\s+as\s+/)
	return (parts[parts.length - 1] ?? "").trim()
}

/** Split a parameter list on commas that are not nested in <>, (), [] or {}. */
function splitParams(list: string): string[] {
	const params: string[] = []
	let depth = 0
	let current = ""
	for (const char of list) {
		if ("<([{".includes(char)) depth += 1
		else if (">)]}".includes(char)) depth -= 1
		if (char === "," && depth === 0) {
			params.push(current)
			current = ""
		} else current += char
	}
	if (current.trim().length > 0) params.push(current)
	return params
}

/** The constructor parameter list of the file's first constructor, or null. */
function constructorParams(source: string): string | null {
	const start = source.search(/\bconstructor\s*\(/)
	if (start === -1) return null
	let depth = 0
	let begin = -1
	for (let i = source.indexOf("(", start); i < source.length; i += 1) {
		if (source[i] === "(") {
			if (depth === 0) begin = i + 1
			depth += 1
		} else if (source[i] === ")") {
			depth -= 1
			if (depth === 0) return source.slice(begin, i)
		}
	}
	return null
}

export type Violation = { file: string; type: string }

export function findViolations(source: string): string[] {
	if (!/@(Injectable|Controller|Module)\s*\(/.test(source)) return []
	const params = constructorParams(source)
	if (params === null) return []
	const typeOnly = typeOnlyImports(source)
	const bad: string[] = []
	for (const param of splitParams(params)) {
		if (/@Inject\s*\(/.test(param)) continue
		const typed = /:\s*([A-Z][\w$]*)\s*(?:<[^>]*>)?\s*$/.exec(param.trim().replace(/\s*=.*$/, ""))
		const name = typed?.[1]
		if (name !== undefined && typeOnly.has(name)) bad.push(name)
	}
	return bad
}

function main(): void {
	const ROOT = resolve(import.meta.dir, "..")
	const violations: Violation[] = []
	for (const base of SCAN) {
		for (const file of walk(resolve(ROOT, base))) {
			for (const type of findViolations(readFileSync(file, "utf8"))) {
				violations.push({ file: relative(ROOT, file), type })
			}
		}
	}

	if (violations.length === 0) {
		console.log("PASS: no injected class is imported with `import type`")
		return
	}
	console.error(`FAIL: ${String(violations.length)} injected class(es) imported with \`import type\`:`)
	for (const v of violations) console.error(`  ${v.file}: ${v.type}`)
	console.error("\nChange the import to a value import (`import { X }`); Nest reads the class at runtime.")
	process.exit(1)
}

if (import.meta.main) main()
