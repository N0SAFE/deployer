// Verify each dynamic-segment layout compiled with the `instant = false` export
// that `isPageAllowedToBlock` reads (compiled shape: "instant",0,!1).
import fs from 'node:fs'
import path from 'node:path'

const dir = '.next/server/chunks/ssr'
const wanted = ['[projectId]', 'nodes_[nodeId]', 'cloudflare', 'environments_[environmentId]', 'services_[serviceId]']

const files = fs.readdirSync(dir).filter((f) => f.includes('layout') && wanted.some((w) => f.includes(w) || f.includes(w.replace('_', '/'))))

console.log('layout chunks found:', files.length)
for (const f of files.sort()) {
  const s = fs.readFileSync(path.join(dir, f), 'utf8')
  const hasFlag = s.includes('"instant",0,!1')
  console.log(`  instant=false: ${String(hasFlag).padEnd(5)}  ${f.slice(0, 70)}`)
}
