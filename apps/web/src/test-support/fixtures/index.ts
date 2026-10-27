import { clusterFixtures } from './cluster'
import { dockerFixtures } from './docker'
import { fleetFixtures } from './fleet'
import { platformFixtures } from './platform'
import { settingsFixtures } from './settings'
import { projectsFixtures } from './projects'
import type { FixtureMap } from './types'

export type { HookFixture } from './types'
export * from './types'

export const HOOK_FIXTURES: FixtureMap = {
	...platformFixtures,
	...fleetFixtures,
	...clusterFixtures,
	...projectsFixtures,
	...settingsFixtures,
	...dockerFixtures,
}
