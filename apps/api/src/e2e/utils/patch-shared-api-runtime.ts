import fs from 'fs'

const file = 'src/e2e/utils/shared-api-runtime.ts'
let content = fs.readFileSync(file, 'utf8')

const fetchRegex = /async fetch\(requestInput, init\) \{.*?return response\n {8}\},/s;

const newLink = `headers: options?.headers ? () => (options.headers as any) : undefined,
        fetch: (input, init) => fetch(input, { ...init, credentials: 'include' }),
        clientInterceptors: [
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
            }
        ],`

content = content.replace(fetchRegex, newLink)
// Also we need to remove `mergeHeaders` import and `toHeaderRecord` since we are doing it locally in the interceptor, but it's simpler to just replace the fetch block.

fs.writeFileSync(file, content)
