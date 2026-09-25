import { createORPCClient } from '@orpc/client'
import type { RouterContract } from '@orpc/contract'
import { OpenAPILink } from '@orpc/openapi/fetch'
import { ObservableLinkPlugin } from '@repo/orpc-utils'
import type {
    SharedOrpcResponseMeta,
    SharedOrpcResponseTracker,
    SharedRuntimeOrpcClient,
    SharedRuntimeOrpcClientOptions,
} from './types'

export function createSharedOrpcResponseTracker(): SharedOrpcResponseTracker {
    const history: SharedOrpcResponseMeta[] = []

    return {
        record(meta) {
            history.push(meta)
        },
        clear() {
            history.length = 0
        },
        getLast() {
            return history.length > 0 ? history.at(-1) ?? null : null
        },
        getAll() {
            return [...history]
        },
    }
}

export function createSharedRuntimeOrpcClient<TContract extends RouterContract>(
    contract: TContract,
    runtime: Pick<import('./types').SharedApiRuntime, 'baseUrl'>,
    options?: SharedRuntimeOrpcClientOptions,
): SharedRuntimeOrpcClient<TContract> {
    const link = new OpenAPILink(contract, {
        // v2: `url` is the base PATH, `origin` is scheme+host. `baseUrl` is an
        // origin (`http://127.0.0.1:<port>`).
        origin: runtime.baseUrl,
        headers: options?.headers,
        fetch: (input, init) => fetch(input, { ...init, credentials: 'include' }),
        plugins: [
            new ObservableLinkPlugin(contract),
        ],
        // v2 renamed `clientInterceptors` to `transportInterceptors` — this
        // interceptor reads the StandardRequest / StandardLazyResponse pair,
        // which is exactly the transport level (post-encode, pre-decode).
        transportInterceptors: [
            async ({ request, next }) => {
                const response = await next()

                if (options?.tracker) {
                    const headersRecord: Record<string, string> = {}
                    const rawHeaders = response.headers ?? {}
                    for (const key in rawHeaders) {
                        const val = rawHeaders[key]
                        if (Array.isArray(val)) {
                            headersRecord[key.toLowerCase()] = val.join(', ')
                        } else if (val !== undefined) {
                            headersRecord[key.toLowerCase()] = String(val)
                        }
                    }

                    options.tracker.record({
                        requestUrl: request.url.toString(),
                        requestMethod: request.method,
                        responseUrl: request.url.toString(),
                        status: response.status,
                        ok: response.status >= 200 && response.status < 300,
                        redirected: false,
                        headers: headersRecord,
                    })
                }

                return response
            },
        ],
    })

    return createORPCClient<SharedRuntimeOrpcClient<TContract>>(link)
}
