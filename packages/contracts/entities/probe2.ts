// Hypothesis: a module that is BOTH an entrypoint AND reachable from another entry
// gets hoisted, and bun drops its re-exports. Test: build ONLY the public entry.
const name = '@/'
const full = '/home/sebille/Bureau/projects/tests/deployer/v3/packages/contracts/entities'
const srcDir = full + '/src'
const PROBES = ['clusterPlatformRoleSchema', 'dockerodeSwarmInfoSchema']

const allGlob = new Bun.Glob('**/*.{ts,tsx}')
const all: string[] = []
for await (const f of allGlob.scan(srcDir)) {
    if (f.includes('.spec.') || f.includes('.test.') || f.includes('__tests__') || f.endsWith('.d.ts')) continue
    all.push(srcDir + '/' + f)
}

async function attempt(label: string, entries: string[]) {
    const od = `${full}/.probe/${label}`
    const r = await Bun.build({
        entrypoints: entries,
        outdir: od,
        root: srcDir,
        format: 'esm',
        target: 'bun',
        splitting: true,
        treeShaking: true,
        packages: 'external',
        external: [name, name + '/*'],
        naming: { entry: '[dir]/[name].mjs', chunk: 'chunks/[name]-[hash].mjs' },
    })
    const idx = od + '/index.mjs'
    if (!(await Bun.file(idx).exists())) {
        console.log(`${label.padEnd(22)} ok=${r.success} NO index.mjs`)
        return
    }
    const mod = await import(idx)
    const txt = await Bun.file(idx).text()
    const hits = PROBES.map((p) => `${p}=${p in mod ? 'OK' : 'MISSING'}`).join(' ')
    console.log(
        `${label.padEnd(22)} ok=${r.success} exp=${String(Object.keys(mod).length).padEnd(4)} export*=${(txt.match(/^export \*/gm) || []).length} ${hits}`
    )
}

await attempt('all-entries', all)
await attempt('public-only', [srcDir + '/index.ts'])
await attempt('no-inner-indexes', all.filter((f) => !/(^|\/)index\.ts$/.test(f) || f === srcDir + '/index.ts'))
