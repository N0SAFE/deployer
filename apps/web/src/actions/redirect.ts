'use server'

import { redirect as r } from 'next/navigation'

export default async function redirect(to: string) {
    // `searchParams.redirectTo` can be `""` (empty string), which `??` does
    // NOT catch — `new URL("")` then throws ERR_INVALID_URL. Normalize any
    // falsy/non-path value to the dashboard.
    const target = to && to.startsWith('/') ? to : '/'
    return await Promise.resolve(r(target))
}
