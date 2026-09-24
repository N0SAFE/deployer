/**
 * Setup redirect target for the WEB app.
 *
 * The web app serves its OWN `/setup` route (the wizard UI is shared from
 * `@repo/ui`, so both surfaces render the identical experience). Setup is
 * therefore a SAME-DEPLOYMENT destination, and the correct redirect is the
 * relative path `/setup`.
 *
 * WHY NOT AN ABSOLUTE URL: this helper previously built
 * `${getBaseApiUrl()}/setup`, and `getBaseApiUrl()` returns the **private
 * Docker address** (`http://nextjs-nestjs-api-dev:3005`) when called on the
 * server. That value went straight into a `Location` header, so the browser was
 * told to visit a hostname that exists only inside the Docker network and the
 * user got `ERR_NAME_NOT_RESOLVED`.
 *
 * The rule this now follows: a relative redirect for a same-deployment target;
 * an absolute URL only for a genuinely external one (see `lib/redirects.ts`).
 *
 * `redirectTo` is forwarded so the operator lands back on whatever they were
 * trying to reach once setup finishes.
 */
export function setupDestinationUrl(options?: { redirectTo?: string | null }): string {
    const params = new URLSearchParams()
    if (options?.redirectTo) params.set('redirectTo', options.redirectTo)
    const query = params.toString()
    return `/setup${query ? `?${query}` : ''}`
}
