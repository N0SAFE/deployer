import { Effect, Fiber } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { CommandRunner } from '@deployer/effect-infra'

import { makeJobRunner, type JobRunnerPorts } from './job-runner'

type Job = { id: string }
type Claimed = { id: string; lockToken: string }

/** A fake queue: one job, a lease the test can take away, and a log of every terminal write. */
function makeQueue(options: { claimable?: boolean } = {}) {
    const writes: string[] = []
    const state = { held: true, heartbeats: 0 }
    const ports: JobRunnerPorts<Job, Claimed, string, unknown> = {
        claim: (job) =>
            Effect.succeed(
                options.claimable === false
                    ? null
                    : { id: job.id, lockToken: 't' }
            ),
        heartbeat: () =>
            Effect.sync(() => {
                state.heartbeats += 1
                return state.held
            }),
        complete: (_claimed, result) =>
            Effect.sync(() => {
                if (!state.held) return false
                writes.push(`complete:${result}`)
                state.held = false
                return true
            }),
        fail: (_claimed, failure) =>
            Effect.sync(() => {
                if (!state.held) return false
                writes.push(`fail:${String(failure)}`)
                state.held = false
                return true
            }),
    }
    return { ports, writes, state }
}

const runner = (
    ports: JobRunnerPorts<Job, Claimed, string, unknown>,
    warn = vi.fn()
) => makeJobRunner(ports, { heartbeatEvery: '20 millis', warn })

describe('makeJobRunner', () => {
    it('skips a job that cannot be claimed', async () => {
        const { ports, writes } = makeQueue({ claimable: false })
        const outcome = await Effect.runPromise(
            runner(ports).run({ id: 'j1' }, () => Effect.succeed('never'))
        )
        expect(outcome).toBe('skipped')
        expect(writes).toEqual([])
    })

    it('writes the result once and heartbeats while the work runs', async () => {
        const { ports, writes, state } = makeQueue()
        const outcome = await Effect.runPromise(
            runner(ports).run({ id: 'j1' }, () =>
                Effect.sleep('100 millis').pipe(Effect.as('image:1'))
            )
        )
        expect(outcome).toBe('completed')
        expect(writes).toEqual(['complete:image:1'])
        expect(state.heartbeats).toBeGreaterThanOrEqual(2)
    })

    it('records a typed failure once', async () => {
        const { ports, writes } = makeQueue()
        const outcome = await Effect.runPromise(
            runner(ports).run({ id: 'j1' }, () => Effect.fail('build exploded'))
        )
        expect(outcome).toBe('failed')
        expect(writes).toEqual(['fail:build exploded'])
    })

    it('records a defect as a failure instead of leaving the job hanging', async () => {
        const { ports, writes } = makeQueue()
        const outcome = await Effect.runPromise(
            runner(ports).run(
                { id: 'j1' },
                () =>
                    Effect.die(new Error('bug')) as Effect.Effect<
                        string,
                        string
                    >
            )
        )
        expect(outcome).toBe('failed')
        expect(writes).toHaveLength(1)
        expect(writes[0]).toContain('bug')
    })

    it('cancel interrupts a 30 s build within a second and writes nothing itself', async () => {
        const { ports, writes } = makeQueue()
        const jobs = runner(ports)
        let started = 0
        let finished = false
        const build = Effect.gen(function* () {
            started = Date.now()
            yield* Effect.sleep('30 seconds')
            finished = true
            return 'never'
        })

        const running = Effect.runPromise(jobs.run({ id: 'j1' }, () => build))
        await new Promise((resolve) => setTimeout(resolve, 50))
        expect(jobs.runningJobIds()).toEqual(['j1'])

        const cancelledAt = Date.now()
        expect(await Effect.runPromise(jobs.cancel('j1'))).toBe(true)
        expect(await running).toBe('cancelled')

        expect(Date.now() - cancelledAt).toBeLessThan(1000)
        expect(started).toBeGreaterThan(0)
        expect(finished).toBe(false)
        expect(writes).toEqual([])
        expect(jobs.runningJobIds()).toEqual([])
        expect(await Effect.runPromise(jobs.cancel('j1'))).toBe(false)
    })

    it('a completion that races a cancel loses the write, so the cancelled state is never overwritten', async () => {
        const { ports, writes, state } = makeQueue()
        const jobs = runner(ports)
        // The canceller has already cleared the token (lease gone) by the time the work finishes.
        const running = Effect.runPromise(
            jobs.run({ id: 'j1' }, () =>
                Effect.sleep('60 millis').pipe(
                    Effect.tap(() =>
                        Effect.sync(() => {
                            state.held = false
                        })
                    ),
                    Effect.as('late')
                )
            )
        )
        expect(await running).toBe('abandoned')
        expect(writes).toEqual([])
    })

    it('stops working on a job whose lease was lost, and writes nothing', async () => {
        const { ports, writes, state } = makeQueue()
        const jobs = runner(ports)
        let finished = false
        const running = Effect.runPromise(
            jobs.run({ id: 'j1' }, () =>
                Effect.sleep('30 seconds').pipe(
                    Effect.tap(() =>
                        Effect.sync(() => {
                            finished = true
                        })
                    ),
                    Effect.as('never')
                )
            )
        )
        await new Promise((resolve) => setTimeout(resolve, 30))
        state.held = false // another worker reclaimed it
        expect(await running).toBe('abandoned')
        expect(finished).toBe(false)
        expect(writes).toEqual([])
    })

    it('tolerates a failing heartbeat and keeps working', async () => {
        const { ports, writes } = makeQueue()
        const warn = vi.fn()
        let calls = 0
        const flaky = {
            ...ports,
            heartbeat: () =>
                ++calls === 1
                    ? Effect.fail(new Error('db blip'))
                    : Effect.succeed(true),
        }
        const outcome = await Effect.runPromise(
            runner(flaky, warn).run({ id: 'j1' }, () =>
                Effect.sleep('90 millis').pipe(Effect.as('ok'))
            )
        )
        expect(outcome).toBe('completed')
        expect(writes).toEqual(['complete:ok'])
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('db blip'))
    })

    it('shutting down (interrupting the run) abandons the job without a terminal write', async () => {
        const { ports, writes } = makeQueue()
        const jobs = runner(ports)
        const fiber = Effect.runFork(
            jobs.run({ id: 'j1' }, () =>
                Effect.sleep('30 seconds').pipe(Effect.as('never'))
            )
        )
        await new Promise((resolve) => setTimeout(resolve, 30))
        await Effect.runPromise(Fiber.interrupt(fiber))
        expect(writes).toEqual([])
        await new Promise((resolve) => setTimeout(resolve, 30))
        expect(jobs.runningJobIds()).toEqual([])
    })

    it('cancelling a job kills the child process it was running', async () => {
        const { ports } = makeQueue()
        const jobs = runner(ports)
        const commands = CommandRunner.layer({ allow: ['sleep'] })
        const execute = () =>
            Effect.gen(function* () {
                const commandRunner = yield* CommandRunner
                yield* commandRunner.run(
                    { exe: 'sleep', args: ['30'] },
                    { timeout: '60 seconds' }
                )
                return 'never'
            }).pipe(Effect.provide(commands)) as Effect.Effect<string, unknown>

        const running = Effect.runPromise(jobs.run({ id: 'j1' }, execute))
        await new Promise((resolve) => setTimeout(resolve, 150))
        const alive = await listSleepers()
        expect(alive.length).toBeGreaterThan(0)
        const pid = alive[0] ?? null

        const cancelledAt = Date.now()
        await Effect.runPromise(jobs.cancel('j1'))
        await running
        await new Promise((resolve) => setTimeout(resolve, 200))

        expect(Date.now() - cancelledAt).toBeLessThan(2000)
        expect(pid).not.toBeNull()
        expect(isAlive(pid ?? -1)).toBe(false)
    })
})

async function listSleepers(): Promise<number[]> {
    const proc = Bun.spawn(['pgrep', '-f', '^sleep 30$'], { stdout: 'pipe' })
    const text = await new Response(proc.stdout).text()
    return text.split('\n').filter(Boolean).map(Number)
}

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0)
        return true
    } catch {
        return false
    }
}
