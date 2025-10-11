// Organization state management with cookie persistence

const DEFAULT_ORG_COOKIE_NAME = 'deployer_default_org'

/**
 * Get the default organization ID from cookie
 */
export function getDefaultOrganizationId(): string | null {
    if (typeof document === 'undefined') return null
    
    const cookies = document.cookie.split(';')
    const orgCookie = cookies.find((cookie) =>
        cookie.trim().startsWith(`${DEFAULT_ORG_COOKIE_NAME}=`)
    )
    
    if (!orgCookie) return null
    
    const value = orgCookie.split('=')[1]
    return value || null
}

/**
 * Set the default organization ID in cookie (expires in 1 year)
 */
export function setDefaultOrganizationId(organizationId: string | null): void {
    if (typeof document === 'undefined') return
    
    if (organizationId === null) {
        // Remove cookie
        document.cookie = `${DEFAULT_ORG_COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`
    } else {
        // Set cookie for 1 year
        const expirationDate = new Date()
        expirationDate.setFullYear(expirationDate.getFullYear() + 1)
        document.cookie = `${DEFAULT_ORG_COOKIE_NAME}=${organizationId}; expires=${expirationDate.toUTCString()}; path=/; SameSite=Lax`
    }
}

/**
 * Clear the default organization cookie
 */
export function clearDefaultOrganizationId(): void {
    setDefaultOrganizationId(null)
}
