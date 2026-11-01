/**
 * `@Global()` drift guard.
 *
 * Nest reads the decorator; the requirement types read `declareModule(..., { global: true })` /
 * `createGlobalModule`. A module that has only the decorator is global at runtime and invisible to the audit, so
 * every consumer reports a false `Missing<[controller, service]>`.
 *
 * RULE: a `*.module.ts` under `apps/` carrying the `@Global()` decorator must also mark its module global in the
 * type layer. Comment mentions (`* @Global() so ...`) do not count — only the decorator line does.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { relative, resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "..")
const APPS = resolve(ROOT, "apps")
const DECORATOR = /^\s*@Global\(\)\s*$/m
const ANNOTATION = /declareModule\(|createGlobalModule\(/
const GLOBAL_OPTION = /global:\s*true/

function walk(dir: string, out: string[] = []): string[] {
	if (!existsSync(dir)) return out
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".turbo") continue
		const path = resolve(dir, entry.name)
		if (entry.isDirectory()) walk(path, out)
		else if (entry.isFile() && entry.name.endsWith(".module.ts")) out.push(path)
	}
	return out
}

const offenders = walk(APPS).filter((file) => {
	const source = readFileSync(file, "utf8")
	if (!DECORATOR.test(source)) return false

	return !(ANNOTATION.test(source) && GLOBAL_OPTION.test(source))
})

if (offenders.length > 0) {
	console.error(`@Global() modules without a type-level global marker (${offenders.length}):`)
	for (const file of offenders) console.error(`  ${relative(ROOT, file)}`)
	console.error("Fix: `export const X = declareModule(XNestModule, { global: true })` from @deployer/nest-effect.")
	process.exit(1)
}

console.log("OK: every @Global() module also declares `global: true` in the type layer.")
