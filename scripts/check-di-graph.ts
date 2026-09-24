/**
 * Static NestJS DI-graph checker.
 *
 * SC1: emits machine-readable DI graph (roots + per-root closure + nodes + edges with file:line).
 * SC2: executable acyclicity gate - exits non-zero on any violation.
 *
 * NODES = every *.module.ts under apps/api/src and packages/.
 * EDGES = DI nesting. A -> B when a class referenced in A's top-level @Module({ imports: [...] })
 *         is imported via a specifier that RESOLVES to B.module.ts.
 *         Dynamic modules are NOT inlined: an inner `imports:` array belongs to the dynamic
 *         module's own context, not to the host module's.
 *
 * EDGE RULE = resolution-based, never specifier-text-based. `../modules/setup/...` written inside
 * apps/api/src/core/orchestrator resolves to apps/api/src/core/modules/setup/... and is therefore
 * core->core, NOT a SC7 violation.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "..")
const API_SRC = resolve(ROOT, "apps/api/src")
const OUT_JSON = resolve(ROOT, "graphify-out/di-graph.json")
const EDGE_RULE = "resolution-based statement-level; dynamic-module inner imports NOT inlined"

function walkModuleFiles(dir: string, out: string[] = []): string[] {
	if (!existsSync(dir)) return out
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		if (e.name === "node_modules" || e.name === "dist" || e.name === ".turbo") continue
		const p = resolve(dir, e.name)
		if (e.isDirectory()) walkModuleFiles(p, out)
		else if (e.isFile() && e.name.endsWith(".module.ts")) out.push(p)
	}
	return out
}

function packageMap(): Map<string, string> {
	const m = new Map<string, string>()
	const pkgs = resolve(ROOT, "packages")
	if (!existsSync(pkgs)) return m
	for (const top of readdirSync(pkgs)) {
		const p = resolve(pkgs, top)
		if (!statSync(p).isDirectory()) continue
		const dirs = existsSync(resolve(p, "package.json"))
			? [p]
			: readdirSync(p)
					.map((s) => resolve(p, s))
					.filter((s) => statSync(s).isDirectory() && existsSync(resolve(s, "package.json")))
		for (const d of dirs) {
			try {
				const j = JSON.parse(readFileSync(resolve(d, "package.json"), "utf8")) as { name?: string }
				if (j.name) m.set(j.name, d)
			} catch {
				/* unreadable package.json - ignore */
			}
		}
	}
	return m
}

// Mask comments only. String literals are preserved so import specifiers survive.
function maskComments(src: string): string {
	const out: string[] = []
	let i = 0
	while (i < src.length) {
		const c = src[i]
		const n = src[i + 1]
		if (c === '"' || c === "'" || c === "`") {
			out.push(c)
			i++
			while (i < src.length && src[i] !== c) {
				if (src[i] === "\\" && i + 1 < src.length) {
					out.push(src[i], src[i + 1])
					i += 2
					continue
				}
				out.push(src[i])
				i++
			}
			if (i < src.length) {
				out.push(c)
				i++
			}
			continue
		}
		if (c === "/" && n === "/") {
			while (i < src.length && src[i] !== "\n") {
				out.push(" ")
				i++
			}
			continue
		}
		if (c === "/" && n === "*") {
			out.push(" ", " ")
			i += 2
			while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
				out.push(src[i] === "\n" ? "\n" : " ")
				i++
			}
			if (i < src.length) {
				out.push(" ", " ")
				i += 2
			}
			continue
		}
		out.push(c)
		i++
	}
	return out.join("")
}

function lineStarts(src: string): number[] {
	const s = [0]
	for (let i = 0; i < src.length; i++) if (src[i] === "\n") s.push(i + 1)
	return s
}
function lineAt(starts: number[], idx: number): number {
	let lo = 0
	let hi = starts.length - 1
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1
		if (starts[mid] <= idx) lo = mid
		else hi = mid - 1
	}
	return lo + 1
}
function matchBracket(s: string, open: number): number {
	let d = 0
	for (let i = open; i < s.length; i++) {
		const ch = s[i]
		if (ch === "(" || ch === "[" || ch === "{") d++
		else if (ch === ")" || ch === "]" || ch === "}") {
			d--
			if (d === 0) return i
		}
	}
	return -1
}

type Prop = { start: number; end: number; text: string }

// Elements of an array literal at depth 1 relative to the region that starts with "[".
function propsAtDepth1(region: string, key: string): Prop[] {
	const res: Prop[] = []
	let d = 0
	for (let i = 0; i < region.length; i++) {
		const ch = region[i]
		if (ch === "(" || ch === "[" || ch === "{") {
			d++
			continue
		}
		if (ch === ")" || ch === "]" || ch === "}") {
			d--
			continue
		}
		if (d !== 1) continue
		if (!region.startsWith(key, i)) continue
		const before = region[i - 1]
		if (before && /[\w$.]/.test(before)) continue
		if (!/^\s*:/.test(region.slice(i + key.length))) continue
		const colon = region.indexOf(":", i + key.length)
		const ob = region.indexOf("[", colon)
		if (ob === -1) continue
		const cb = matchBracket(region, ob)
		if (cb === -1) continue
		res.push({ start: ob, end: cb, text: region.slice(ob + 1, cb) })
		i = cb
	}
	return res
}

type Item = { ident: string | null; idx: number; raw: string }

// Split an array-literal body on top-level commas; keep the first identifier of each element.
function topItems(text: string, baseIdx: number): Item[] {
	const items: Item[] = []
	let d = 0
	let start = 0
	for (let i = 0; i <= text.length; i++) {
		const ch = text[i]
		if (i < text.length) {
			if (ch === "(" || ch === "[" || ch === "{") d++
			else if (ch === ")" || ch === "]" || ch === "}") d--
		}
		if ((i === text.length || ch === ",") && d === 0) {
			const raw = text.slice(start, i)
			const trimmed = raw.trim()
			if (trimmed) {
				const lead = raw.length - raw.trimStart().length
				const m = trimmed.match(/^([A-Za-z_$][\w$]*)/)
				items.push({ ident: m ? m[1] : null, idx: baseIdx + start + lead, raw: trimmed.slice(0, 60) })
			}
			start = i + 1
		}
	}
	return items
}

type Spec = { spec: string; line: number; kind: string }

function collectSpecs(masked: string, starts: number[]): Spec[] {
	const res: Spec[] = []
	let x: RegExpExecArray | null
	const reStatic = /import\s+(?:type\s+)?[^;]*?\s+from\s+["']([^"']+)["']/g
	while ((x = reStatic.exec(masked))) res.push({ spec: x[1], line: lineAt(starts, x.index), kind: "import" })
	const reRe = /export\s+(?:type\s+)?[^;]*?\s+from\s+["']([^"']+)["']/g
	while ((x = reRe.exec(masked))) res.push({ spec: x[1], line: lineAt(starts, x.index), kind: "reexport" })
	const reDyn = /import\(\s*["']([^"']+)["']\s*\)/g
	while ((x = reDyn.exec(masked))) res.push({ spec: x[1], line: lineAt(starts, x.index), kind: "dynamic" })
	const reReq = /require\(\s*["']([^"']+)["']\s*\)/g
	while ((x = reReq.exec(masked))) res.push({ spec: x[1], line: lineAt(starts, x.index), kind: "require" })
	return res
}

function importBindings(masked: string, starts: number[]): Map<string, { spec: string; line: number }> {
	const m = new Map<string, { spec: string; line: number }>()
	const re = /import\s+(?:type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/g
	let x: RegExpExecArray | null
	while ((x = re.exec(masked))) {
		const clause = x[1]
		const spec = x[2]
		const line = lineAt(starts, x.index)
		const ns = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/)
		if (ns) m.set(ns[1], { spec, line })
		const named = clause.match(/\{([\s\S]*)\}/)
		if (named) {
			for (const part of named[1].split(",")) {
				const p = part.trim()
				if (!p) continue
				const mm = p
					.replace(/^type\s+/, "")
					.replace(/\s+as\s+[\w$]+/, "")
					.match(/^([A-Za-z_$][\w$]*)/)
				if (mm) m.set(mm[1], { spec, line })
			}
		}
		const defaultPart = clause.split("{")[0].replace(/\*\s+as[\s\S]*/, "").trim()
		const dm = defaultPart.match(/^([A-Za-z_$][\w$]*)/)
		if (dm) m.set(dm[1], { spec, line })
	}
	return m
}

function tryFile(p: string): string | null {
	for (const c of [p, `${p}.ts`, `${p}.tsx`, resolve(p, "index.ts")]) {
		if (existsSync(c) && statSync(c).isFile()) return c
	}
	return null
}

function resolveSpec(spec: string, fromFile: string, pkgMap: Map<string, string>): string | null {
	if (spec.startsWith(".")) return tryFile(resolve(dirname(fromFile), spec))
	if (spec.startsWith("@/")) return tryFile(resolve(API_SRC, spec.slice(2)))
	if (spec.startsWith("~/")) return tryFile(resolve(ROOT, spec.slice(2)))
	for (const [name, dir] of pkgMap) {
		if (spec === name) return tryFile(dir)
		if (spec.startsWith(`${name}/`)) return tryFile(resolve(dir, spec.slice(name.length + 1)))
	}
	return null
}
const pkgMap = packageMap()
const moduleFiles = [...walkModuleFiles(API_SRC), ...walkModuleFiles(resolve(ROOT, "packages"))].sort()
const moduleSet = new Set(moduleFiles)

type NodeInfo = { file: string; rel: string; classes: string[]; global: boolean; importsItems: string[]; declLine: number }
const nodes = new Map<string, NodeInfo>()
const fileMasked = new Map<string, string>()
const fileStarts = new Map<string, number[]>()
const fileBindings = new Map<string, Map<string, { spec: string; line: number }>>()

function decoratorRegions(masked: string): { open: number; close: number }[] {
	const out: { open: number; close: number }[] = []
	let from = 0
	for (;;) {
		const at = masked.indexOf("@Module(", from)
		if (at === -1) break
		const open = masked.indexOf("(", at)
		const close = matchBracket(masked, open)
		if (close === -1) break
		out.push({ open, close })
		from = close
	}
	return out
}
for (const f of moduleFiles) {
	const src = readFileSync(f, "utf8")
	const masked = maskComments(src)
	const starts = lineStarts(src)
	fileMasked.set(f, masked)
	fileStarts.set(f, starts)
	fileBindings.set(f, importBindings(masked, starts))
	const classes: string[] = []
	for (const m of masked.matchAll(/export\s+class\s+([A-Za-z_$][\w$]*)/g)) classes.push(m[1])
	for (const m of masked.matchAll(/(?<![\w$.])class\s+([A-Za-z_$][\w$]*)/g)) if (!classes.includes(m[1])) classes.push(m[1])
	const region0 = decoratorRegions(masked)[0]
	let importsItems: string[] = []
	let declLine = 1
	if (region0) {
		declLine = lineAt(starts, region0.open)
		const region = masked.slice(region0.open + 1, region0.close)
		const props = propsAtDepth1(region, "imports")
		if (props[0]) importsItems = topItems(props[0].text, region0.open + 1 + props[0].start + 1).map((i) => i.ident ?? "")
	}
	nodes.set(f, { file: f, rel: relative(ROOT, f), classes, global: /@Global\s*\(\s*\)/.test(masked), importsItems, declLine })
}
type Edge = { from: string; to: string; fromRel: string; toRel: string; line: number; via: string }

function classImportsEdges(file: string): Edge[] {
	const bindings = fileBindings.get(file) ?? new Map()
	const masked = fileMasked.get(file) ?? ""
	const starts = fileStarts.get(file) ?? [0]
	const region0 = decoratorRegions(masked)[0]
	if (!region0) return []
	const region = masked.slice(region0.open + 1, region0.close)
	const out: Edge[] = []
	for (const prop of propsAtDepth1(region, "imports")) {
		for (const it of topItems(prop.text, region0.open + 1 + prop.start + 1)) {
			if (!it.ident) continue
			const b = bindings.get(it.ident)
			if (!b) continue
			const resolved = resolveSpec(b.spec, file, pkgMap)
			if (!resolved || resolved === file || !moduleSet.has(resolved)) continue
			out.push({ from: file, to: resolved, fromRel: relative(ROOT, file), toRel: relative(ROOT, resolved), line: lineAt(starts, it.idx), via: it.ident })
		}
	}
	return out
}
const diEdges: Edge[] = []
for (const f of moduleFiles) diEdges.push(...classImportsEdges(f))

const fileEdges: Edge[] = []
for (const f of moduleFiles) {
	const bindings = fileBindings.get(f) ?? new Map()
	const seen = new Set<string>()
	for (const b of bindings.values()) {
		const resolved = resolveSpec(b.spec, f, pkgMap)
		if (!resolved || resolved === f || !moduleSet.has(resolved) || seen.has(resolved)) continue
		seen.add(resolved)
		fileEdges.push({ from: f, to: resolved, fromRel: relative(ROOT, f), toRel: relative(ROOT, resolved), line: b.line, via: b.spec })
	}
}

function sccs(fileList: string[], edges: Edge[]): string[][] {
	const adj = new Map<string, string[]>()
	for (const f of fileList) adj.set(f, [])
	for (const e of edges) adj.get(e.from)?.push(e.to)
	const index = new Map<string, number>()
	const low = new Map<string, number>()
	const onStack = new Set<string>()
	const stack: string[] = []
	const out: string[][] = []
	let counter = 0
	const strongconnect = (v: string): void => {
		index.set(v, counter)
		low.set(v, counter)
		counter++
		stack.push(v)
		onStack.add(v)
		for (const w of adj.get(v) ?? []) {
			if (!index.has(w)) {
				strongconnect(w)
				low.set(v, Math.min(low.get(v) as number, low.get(w) as number))
			} else if (onStack.has(w)) {
				low.set(v, Math.min(low.get(v) as number, index.get(w) as number))
			}
		}
		if (low.get(v) === index.get(v)) {
			const comp: string[] = []
			let w: string
			do {
				w = stack.pop() as string
				onStack.delete(w)
				comp.push(w)
			} while (w !== v)
			out.push(comp)
		}
	}
	for (const f of fileList) if (!index.has(f)) strongconnect(f)
	return out
}

function cycleReport(fileList: string[], edges: Edge[], label: string): string[][] {
	const comps = sccs(fileList, edges)
	const selfLoops = new Set(edges.filter((e) => e.from === e.to).map((e) => e.from))
	const cyclic = comps.filter((c) => c.length > 1 || selfLoops.has(c[0]))
	console.log(`\n=== ${label}: ${cyclic.length} cycle(s) ===`)
	for (const c of cyclic) {
		console.log(c.length > 1 ? `  [SCC ${c.length} files]` : "  [self-loop]")
		const set = new Set(c)
		for (const e of edges.filter((e) => set.has(e.from) && set.has(e.to))) {
			console.log(`    ${e.fromRel}:${e.line} --${e.via}--> ${e.toRel}`)
		}
	}
	return cyclic
}

const diCycles = cycleReport(moduleFiles, diEdges, "DI-NESTING CYCLES (gated)")
const fileCycles = cycleReport(moduleFiles, fileEdges, "MODULE-FILE STATIC-IMPORT CYCLES (informational)")

const diAdj = new Map<string, Edge[]>()
for (const e of diEdges) {
	if (!diAdj.has(e.from)) diAdj.set(e.from, [])
	;(diAdj.get(e.from) as Edge[]).push(e)
}

// Roots are derived, not hardcoded: anchor file + class name at the boot call site, then the
// class is resolved through that anchor's own import bindings (alias or relative both work).
type RootDef = { anchorRel: string; cls: string; site: string }
const ROOT_DEFS: RootDef[] = [
{ anchorRel: "main.ts", cls: "OrchestrationModule", site: "NestFactory.create(OrchestrationModule)" },
{ anchorRel: "core/orchestrator/orchestrator.service.ts", cls: "SetupDevModule", site: "createApplicationContext(SetupDevModule)" },
{ anchorRel: "core/orchestrator/orchestrator.service.ts", cls: "SetupSubAppModule", site: "runSubApp(port 3010)" },
{ anchorRel: "core/orchestrator/orchestrator.service.ts", cls: "MeshInitializerAppModule", site: "runSubApp(port 3011)" },
{ anchorRel: "core/orchestrator/orchestrator.service.ts", cls: "AppModule", site: "runSubApp(port 3012)" },
{ anchorRel: "cli.ts", cls: "CLIModule", site: "CommandFactory.run(CLIModule)" },
{ anchorRel: "core/modules/sub-app-runner/sub-app-runner.module.ts", cls: "SubAppHostModule", site: "createApplicationContext(SubAppHostModule) runtime-generated" },
]

function findLine(file: string, needle: string): number {
const masked = fileMasked.get(file)
const starts = fileStarts.get(file)
if (!masked || !starts) return 0
const idx = masked.indexOf(needle)
return idx === -1 ? 0 : lineAt(starts, idx)
}

type RootInfo = {
cls: string
site: string
anchor: string
resolvedModule: string | null
refLine: number
status: string
closure: string[]
touches: string[]
dockerode: boolean
globalPostgres: boolean
}

function findLine(file: string, needle: string): number {
	const masked = fileMasked.get(file)
	const starts = fileStarts.get(file)
	if (!masked || !starts) return 0
	// Last occurrence = the usage site. The first occurrence is the import line.
	const idx = masked.lastIndexOf(needle)
	return idx === -1 ? 0 : lineAt(starts, idx)
}

// Anchors (main.ts, cli.ts) are not *.module.ts, so they are not in the scan above.
// Load any file on demand into the same caches.
function ensureLoaded(f: string): void {
	if (fileMasked.has(f) || !existsSync(f)) return
	const src = readFileSync(f, "utf8")
	const masked = maskComments(src)
	const starts = lineStarts(src)
	fileMasked.set(f, masked)
	fileStarts.set(f, starts)
	fileBindings.set(f, importBindings(masked, starts))
}
const roots: RootInfo[] = []
for (const d of ROOT_DEFS) {
	const anchor = resolve(API_SRC, d.anchorRel)
	if (!existsSync(anchor)) {
		roots.push({ cls: d.cls, site: d.site, anchor: d.anchorRel, resolvedModule: null, refLine: 0, status: "anchor-missing", closure: [], touches: [], dockerode: false, globalPostgres: false })
		continue
	}
	ensureLoaded(anchor)
	const bindings = fileBindings.get(anchor) ?? new Map()
	const b = bindings.get(d.cls)
	const resolved = b ? resolveSpec(b.spec, anchor, pkgMap) : null
	const refLine = findLine(anchor, d.cls)
	const isMod = resolved !== null && moduleSet.has(resolved)
	const selfDecl = !b && new RegExp(`class\\s+${d.cls}`).test(fileMasked.get(anchor) ?? "")
	const rootFile = isMod ? (resolved as string) : selfDecl ? anchor : null
	const visited = new Set<string>()
	const stack = rootFile ? [rootFile] : []
	while (stack.length) {
		const cur = stack.pop() as string
		if (visited.has(cur)) continue
		visited.add(cur)
		for (const e of diAdj.get(cur) ?? []) if (!visited.has(e.to)) stack.push(e.to)
	}
	const closure = [...visited].map((f) => relative(ROOT, f)).sort()
	const tags = new Set<string>()
	for (const rel of closure) {
		if (/global-database\.module/.test(rel)) tags.add("global-postgres")
		if (/docker/.test(rel)) tags.add("docker")
		if (/swarm/.test(rel)) tags.add("swarm")
		if (/mesh/.test(rel)) tags.add("mesh")
		if (/postgres/.test(rel)) tags.add("postgres")
	}
	let doker = false
	for (const f of visited) if (/dockerode/.test(fileMasked.get(f) ?? "")) doker = true
	roots.push({
		cls: d.cls,
		site: d.site,
		anchor: d.anchorRel,
		resolvedModule: rootFile ? relative(ROOT, rootFile) : null,
		refLine,
		status: isMod ? "resolved" : selfDecl ? "self-declared(runtime)" : "unresolved",
		closure,
		touches: [...tags].sort(),
		dockerode: doker,
		globalPostgres: [...visited].some((f) => /global-database\.module/.test(f)),
	})
}

console.log(`\n=== COMPOSITION ROOTS (${roots.length}) ===`)
for (const r of roots) {
	console.log(`  ${r.anchor}:${r.refLine} ${r.cls} [${r.status}]`)
	console.log(`      root=${r.resolvedModule ?? "-"} closure=${r.closure.length} touches=[${r.touches.join(",")}] dockerode=${String(r.dockerode)} globalPostgres=${String(r.globalPostgres)}`)
}

// ── SC7: core -> modules reverse imports (resolution-based) ───────────────────
const CORE_PREFIX = `${resolve(API_SRC, "core")}/`
const MODULES_PREFIX = `${resolve(API_SRC, "modules")}/`

function listAllTs(dir: string, out: string[] = []): string[] {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		if (e.name === "node_modules") continue
		const p = resolve(dir, e.name)
		if (e.isDirectory()) listAllTs(p, out)
		else if (e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".spec.ts")) out.push(p)
	}
	return out
}

const sc7: { file: string; line: number; spec: string; resolved: string; kind: string }[] = []
for (const f of listAllTs(resolve(API_SRC, "core"))) {
	const masked = fileMasked.get(f) ?? maskComments(readFileSync(f, "utf8"))
	const starts = fileStarts.get(f) ?? lineStarts(readFileSync(f, "utf8"))
	for (const s of collectSpecs(masked, starts)) {
		if (s.kind === "dynamic" || s.kind === "require") {
			const resolved = resolveSpec(s.spec, f, pkgMap)
			if (resolved && resolved.startsWith(MODULES_PREFIX)) {
				sc7.push({ file: relative(ROOT, f), line: s.line, spec: s.spec, resolved: relative(ROOT, resolved), kind: s.kind })
			}
		}
	}
	for (const [local, b] of importBindings(masked, starts)) {
		const resolved = resolveSpec(b.spec, f, pkgMap)
		if (resolved && resolved.startsWith(MODULES_PREFIX)) {
			sc7.push({ file: relative(ROOT, f), line: b.line, spec: b.spec, resolved: relative(ROOT, resolved), kind: `import:${local}` })
		}
	}
}
const sc7List = [...new Map(sc7.map((v) => [`${v.file}:${v.line}:${v.spec}`, v])).values()].sort(
	(a, b) => a.file.localeCompare(b.file) || a.line - b.line,
)
console.log(`\n=== SC7 core->modules REVERSE IMPORTS (resolution-based): ${sc7List.length} ===`)
for (const v of sc7List) console.log(`  ${v.file}:${v.line} "${v.spec}" -> ${v.resolved}  [${v.kind}]`)
void CORE_PREFIX

// ── SC7 transitive variant (informational) ────────────────────────────────────
// Build a static-import graph over ALL .ts files (core + modules) and count core files whose
// transitive closure reaches apps/api/src/modules — directly or indirectly.
const importGraph = new Map<string, string[]>()
for (const f of [...listAllTs(resolve(API_SRC, "core")), ...listAllTs(resolve(API_SRC, "modules")), ...moduleFiles]) {
	ensureLoaded(f)
	const adj: string[] = []
	for (const b of (fileBindings.get(f) ?? new Map()).values()) {
		const r = resolveSpec(b.spec, f, pkgMap)
		if (r && r !== f) adj.push(r)
	}
	importGraph.set(f, adj)
}
const coreFileList = listAllTs(resolve(API_SRC, "core"))
const directSet = new Set(sc7List.map((v) => resolve(ROOT, v.file)))
function transReaches(start: string): boolean {
	const seen = new Set<string>([start])
	const stack = [start]
	while (stack.length) {
		const cur = stack.pop() as string
		for (const w of importGraph.get(cur) ?? []) {
			if (seen.has(w)) continue
			if (w.startsWith(MODULES_PREFIX)) return true
			seen.add(w)
			stack.push(w)
		}
	}
	return false
}
const transitiveFiles = coreFileList.filter((f) => transReaches(f))
console.log(`\n=== SC7 EDGE-RULE COMPARISON ===`)
console.log(`  statement-level (direct specifier parse): ${sc7List.length} edges in ${directSet.size} file(s)`)
console.log(`  transitive (closure through all .ts):      ${transitiveFiles.length} core file(s) reach modules/`)

// ── SC8: node-repo provider duplication ──────────────────────────────────────
const NODE_REPOS = ["NodeConfigRepository", "ClusterNodeRepository", "ClusterNodeInventoryRepository"]
const sc8: Record<string, { file: string; line: number; exported: boolean }[]> = {}
for (const name of NODE_REPOS) {
	sc8[name] = []
	for (const f of moduleFiles) {
		const masked = fileMasked.get(f) as string
		const starts = fileStarts.get(f) as number[]
		const region0 = decoratorRegions(masked)[0]
		if (!region0) continue
		const region = masked.slice(region0.open + 1, region0.close)
		const exportProps = propsAtDepth1(region, "exports")
		const exported = exportProps.some((p) => topItems(p.text, region0.open + 1 + p.start + 1).some((i) => i.ident === name))
		for (const p of propsAtDepth1(region, "providers")) {
			for (const it of topItems(p.text, region0.open + 1 + p.start + 1)) {
				if (it.ident === name) sc8[name].push({ file: relative(ROOT, f), line: lineAt(starts, it.idx), exported })
			}
		}
	}
}
console.log("\n=== SC8 node-repo provider declarations ===")
let sc8Dup = 0
for (const name of NODE_REPOS) {
	const list = sc8[name]
	if (list.length > 1) sc8Dup++
	console.log(`  ${name}: ${list.length} declaration(s)${list.length > 1 ? "  <-- DUPLICATE" : ""}`)
	for (const d of list) console.log(`     ${d.file}:${d.line}${d.exported ? " (exported)" : ""}`)
}

// ── artifact (SC1) ────────────────────────────────────────────────────────────
function cycleShape(comps: string[][], edges: Edge[]) {
	return comps.map((c) => {
		const set = new Set(c)
		return {
			size: c.length,
			nodes: c.map((f) => relative(ROOT, f)),
			edges: edges.filter((e) => set.has(e.from) && set.has(e.to)).map((e) => ({ from: e.fromRel, to: e.toRel, line: e.line, via: e.via })),
		}
	})
}

const artifact = {
	generatedAt: new Date().toISOString(),
	edgeRule: EDGE_RULE,
	counts: {
		moduleFiles: moduleFiles.length,
		diEdges: diEdges.length,
		moduleFileStaticEdges: fileEdges.length,
		diCycles: diCycles.length,
		staticImportCycles: fileCycles.length,
		roots: roots.length,
		sc7Violations: sc7List.length,
		sc7TransitiveCoreFiles: transitiveFiles.length,
		sc8DuplicateRepos: sc8Dup,
	},
	cycles: cycleShape(diCycles, diEdges),
	staticImportCycles: cycleShape(fileCycles, fileEdges),
	roots,
	nodes: [...nodes.values()].map((n) => ({ file: n.rel, classes: n.classes, global: n.global, declLine: n.declLine, imports: n.importsItems.filter(Boolean) })),
	edges: diEdges.map((e) => ({ from: e.fromRel, to: e.toRel, line: e.line, via: e.via })),
	sc7Violations: sc7List,
	sc7Transitive: transitiveFiles.map((f) => relative(ROOT, f)),
	sc8,
}
writeFileSync(OUT_JSON, `${JSON.stringify(artifact, null, 2)}\n`)
console.log(`\nartifact: ${relative(ROOT, OUT_JSON)}`)

// Gate. DI_GATE=cycles gates on acyclicity alone (SC2 scope); default gates on all rules.
const gate = process.env.DI_GATE ?? "all"
const cycleFail = diCycles.length > 0
const advisoryFail = sc7List.length > 0 || sc8Dup > 0
if (cycleFail || (gate === "all" && advisoryFail)) {
	console.log(`\nFAIL (DI_GATE=${gate}): diCycles=${diCycles.length} sc7=${sc7List.length} sc8DuplicateRepos=${sc8Dup}`)
	if (gate === "all" && !cycleFail) console.log("  (only advisory rules failed; run with DI_GATE=cycles to gate on acyclicity alone)")
	process.exit(1)
}
console.log(gate === "cycles" ? "\nPASS (DI_GATE=cycles): no DI-nesting cycles" : "\nPASS (DI_GATE=all): no DI cycles, no core->modules reverse imports, no duplicate node-repo providers")
