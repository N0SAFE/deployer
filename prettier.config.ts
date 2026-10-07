// The explicit `.ts` extension matters: Node's native TypeScript loader
// (Node 24, used when prettier imports a TS config) does not do extensionless
// resolution, and without it every `prettier` invocation fails to load this
// config with "Cannot find module .../src/base".
import config from './tooling/prettier/src/base.ts'

export default config
