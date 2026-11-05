import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { bootAgent, freshDataDir, removeDataDir } from './boot-agent'

/**
 * The agent's local socket is a deployment mount point: it binds wherever the run volume is mounted — and the publisher
 * (`NODE_AGENT_SOCKET`) is the same path the node door uses.
 */
describe("the agent's local socket", () => {
    it('binds where the deployment mounts it', async () => {
        const dataDir = freshDataDir()
        const socketPath = join(dataDir, 'v2.sock')
        const agent = await bootAgent({ dataDir, socketPath })

        try {
            expect(agent.transport.localSocketPath).toBe(socketPath)
            expect(existsSync(socketPath)).toBe(true)
        } finally {
            await agent.stop()
        }

        // Nest owns the shutdown: closing the app removes the socket, so a restart binds it cleanly.
        expect(existsSync(socketPath)).toBe(false)
        removeDataDir(dataDir)
    })
})
