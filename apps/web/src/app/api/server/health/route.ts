import { getErrorMessage } from "@/lib/orpc/typed-errors";
import { NextResponse } from 'next/server'
import { connection } from 'next/server'
import { orpc } from '@/lib/orpc'
import { unstable_rethrow } from 'next/navigation'

export async function GET() {
    // The handler probes the API over the network and reports whether it is
    // reachable right now. With `cacheComponents` enabled, Next.js would
    // otherwise try to PRERENDER this route at build time — where there is no
    // API to talk to — so the fetch hangs until the 60s build-worker timeout
    // and the route fails three times, aborting the build.
    //
    // `connection()` opts the route out of prerendering: execution resumes only
    // for a real request, so the reachability check always runs against the live
    // API. It is the Cache Components replacement for `dynamic = 'force-dynamic'`
    // (the export is now rejected outright).
    await connection()

    try {
        const webHealth = {
            status: 'ok',
            timestamp: new Date().toISOString(),
        }

        const apiHealth = {
            status: 'unavailable' as string,
            timestamp: new Date().toISOString(),
            details: 'API could not be reached' as string,
        }

        try {
            // Check the NestJS API health endpoint using ORPC
            const apiRes = await orpc.health.check.call({})

            if (apiRes.status === 'ok') {
                return NextResponse.json({
                    web: webHealth,
                    api: apiRes,
                })
            } else {
                apiHealth.details = `API returned status: ${apiRes.status}`
                apiHealth.status = 'error'
            }
        } catch (error: unknown) {
            unstable_rethrow(error)
            if (error instanceof Error) {
                apiHealth.details = `Error fetching API health: ${getErrorMessage(error)}`
            }
            apiHealth.status = 'unavailable'
        }

        const healthStatus = {
            web: webHealth,
            api: apiHealth,
        }

        const isHealthy = webHealth.status === 'ok' && apiHealth.status === 'ok'

        return NextResponse.json(healthStatus, {
            status: isHealthy ? 200 : 503,
        })
    } catch (error: unknown) {
        unstable_rethrow(error)
        return NextResponse.json(
            {
                status: 'error',
                message: 'An unexpected error occurred during health check.',
                error: (error as Error).message,
            },
            { status: 500 }
        )
    }
}
