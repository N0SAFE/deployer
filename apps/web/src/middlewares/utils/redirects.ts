import { NextResponse, type NextRequest } from 'next/server'

/**
 * Redirect to a SAME-DEPLOYMENT path, resolved against the request's own origin.
 *
 * WHY THIS EXISTS
 * ---------------
 * `NextResponse.redirect()` requires an absolute URL, so every same-app redirect
 * (sign-in, error pages, setup) was previously built with `toAbsoluteUrl()`,
 * which composes from `NEXT_PUBLIC_APP_URL`. That makes the redirect depend on a
 * CONFIG VALUE that must independently happen to be correct for whatever origin
 * the browser actually used — a proxy, a tunnel, a bare IP or a port all break
 * it, and in this repo an internal Docker hostname
 * (`http://nextjs-nestjs-api-dev:3005`) reached a `Location` header, producing
 * `ERR_NAME_NOT_RESOLVED` in the browser.
 *
 * The request already knows the origin the browser reached — by definition a
 * reachable one — so resolving against `request.url` cannot produce an
 * unreachable target. Use this for every in-deployment redirect; use an explicit
 * absolute URL only for a genuinely external destination.
 */
export function redirectSameOrigin(request: NextRequest, path: string): NextResponse {
    // `path` is a relative in-deployment route ("/auth/signin?..."); `new URL`
    // drops the base entirely if an absolute URL is passed, so an accidental
    // absolute value here would silently cross origins. Guard it explicitly.
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
        return NextResponse.redirect(path)
    }
    return NextResponse.redirect(new URL(path, request.url))
}

/** Absolute URL of a same-deployment path, for comparison/logging. */
export function sameOriginUrl(request: NextRequest, path: string): string {
    return new URL(path, request.url).toString()
}
