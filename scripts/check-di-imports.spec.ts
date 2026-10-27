import { describe, expect, it } from "vitest"

import { findViolations } from "./check-di-imports"

const service = (imports: string, ctor: string) => `
${imports}
import { Injectable } from "@nestjs/common"

@Injectable()
export class Thing {
	constructor(${ctor}) {}
}
`

describe("check-di-imports", () => {
	it("flags the shape that crashed the BFF: a client imported with `import type`", () => {
		const source = service(
			'import type { IdentityClient } from "@/clients/identity.client"\nimport { ProjectClient } from "@/clients/project.client"',
			"private readonly identity: IdentityClient, private readonly projects: ProjectClient",
		)

		expect(findViolations(source)).toEqual(["IdentityClient"])
	})

	it("flags an inline `type` specifier too", () => {
		const source = service('import { type Repo, other } from "./repo"', "private readonly repo: Repo")

		expect(findViolations(source)).toEqual(["Repo"])
	})

	it("accepts a value import", () => {
		expect(findViolations(service('import { Repo } from "./repo"', "private readonly repo: Repo"))).toEqual([])
	})

	it("accepts a type-only import when the parameter names its token with @Inject", () => {
		const source = service(
			'import type { Pool } from "pg"',
			"@Inject(DATABASE_POOL) private readonly pool: Pool",
		)

		expect(findViolations(source)).toEqual([])
	})

	it("ignores a plain class that is not a Nest provider", () => {
		const source = `import type { Repo } from "./repo"\nexport class Plain { constructor(private readonly repo: Repo) {} }`

		expect(findViolations(source)).toEqual([])
	})

	it("ignores an array parameter: Nest cannot inject one by type (it comes from a factory)", () => {
		const source = service('import type { Provider } from "./provider"', "private readonly providers: Provider[]")

		expect(findViolations(source)).toEqual([])
	})

	it("handles generic and multi-line parameter lists", () => {
		const source = service(
			'import type { Registry } from "./registry"',
			"\n\tprivate readonly a: Map<string, number>,\n\tprivate readonly registry: Registry,\n",
		)

		expect(findViolations(source)).toEqual(["Registry"])
	})
})
