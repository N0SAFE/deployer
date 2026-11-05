import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'

import {
    AgentStore,
    agentStoreOver,
    openAgentStore,
} from '../../../local/agent-store'

import { NODE_LABELS_SECRET, NodeLabels } from './node-labels.service'

const dirs: string[] = []
const freshDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'node-labels-'))
    dirs.push(dir)
    return dir
}
afterEach(() => {
    for (const dir of dirs.splice(0))
        rmSync(dir, { recursive: true, force: true })
})

const over =
    (store: AgentStore['Service']) =>
    <A, E>(effect: Effect.Effect<A, E, AgentStore>) =>
        Effect.runPromise(effect.pipe(Effect.provideService(AgentStore, store)))

describe('NodeLabels', () => {
    it('answers with nothing on a node that published no label', async () => {
        const run = over(agentStoreOver(new DatabaseSync(':memory:') as never))

        expect(await run(new NodeLabels.live().read())).toEqual({})
    })

    it('merges labels without dropping the ones already there', async () => {
        const store = agentStoreOver(new DatabaseSync(':memory:') as never)
        const run = over(store)

        expect(
            await run(
                new NodeLabels.live().merge({ 'deployer.node-id': 'node-1' })
            )
        ).toEqual({ 'deployer.node-id': 'node-1' })
        expect(
            await run(new NodeLabels.live().merge({ environment: 'prod' }))
        ).toEqual({
            'deployer.node-id': 'node-1',
            environment: 'prod',
        })
        expect(await run(new NodeLabels.live().read())).toEqual({
            'deployer.node-id': 'node-1',
            environment: 'prod',
        })
    })

    it('keeps the labels across a reopen of the store', async () => {
        const dir = freshDir()
        const first = await openAgentStore(dir)
        await over(first)(
            new NodeLabels.live().merge({ 'deployer.node-id': 'node-1' })
        )
        await Effect.runPromise(first.close())

        const second = await openAgentStore(dir)
        expect(await over(second)(new NodeLabels.live().read())).toEqual({
            'deployer.node-id': 'node-1',
        })
        await Effect.runPromise(second.close())
    })

    it('treats a malformed stored value as no labels, so the roster keeps working', async () => {
        const store = agentStoreOver(new DatabaseSync(':memory:') as never)
        await Effect.runPromise(
            store.putSecret(NODE_LABELS_SECRET, '{not-json')
        )

        expect(await over(store)(new NodeLabels.live().read())).toEqual({})
        expect(
            await over(store)(new NodeLabels.live().merge({ a: '1' }))
        ).toEqual({ a: '1' })
    })
})
