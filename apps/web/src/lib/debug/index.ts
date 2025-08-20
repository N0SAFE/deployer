import { validateEnvSafe } from '#/env'

const env = validateEnvSafe(process.env).data

// ANSI color codes
const YELLOW = '\x1b[33m'
const PURPLE = '\x1b[35m'
const RESET = '\x1b[0m'

/**
 * Debug configuration interface
 */
interface DebugConfig {
    patterns: string[]
    enableAll: boolean
}

/**
 * Expand a pattern with brace notation into multiple patterns
 * @param pattern Pattern like "middleware/{auth,router,cors}/*"
 * @returns Array of expanded patterns like ["middleware/auth/*", "middleware/router/*", "middleware/cors/*"]
 */
function expandBracePattern(pattern: string): string[] {
    // Check if pattern contains braces
    const braceMatch = pattern.match(/^(.+?)\{([^}]+)\}(.*)$/)
    if (!braceMatch) {
        return [pattern] // No braces, return as-is
    }
    
    const [, prefix, options, suffix] = braceMatch
    const optionsList = options.split(',').map(opt => opt.trim())
    
    return optionsList.map(option => `${prefix}${option}${suffix}`)
}

/**
 * Check if a scope matches a debug pattern (supports wildcards and brace expansion)
 * @param scope The scope to check (e.g., "middleware/auth/session")
 * @param pattern The pattern to match against (e.g., "middleware/*", "middleware/{auth,router}/*", "*")
 * @returns true if the scope matches the pattern
 */
function matchesPattern(scope: string, pattern: string): boolean {
    // Expand brace patterns first
    const expandedPatterns = expandBracePattern(pattern)
    
    // Check if scope matches any of the expanded patterns
    return expandedPatterns.some(expandedPattern => {
        // If pattern is "*", match everything
        if (expandedPattern === '*') {
            return true
        }
        
        // If pattern ends with "/*", match all scopes starting with the prefix
        if (expandedPattern.endsWith('/*')) {
            const prefix = expandedPattern.slice(0, -2) // Remove "/*"
            return scope.startsWith(prefix + '/') || scope === prefix
        }
        
        // If pattern ends with "/**", match all nested scopes starting with the prefix
        if (expandedPattern.endsWith('/**')) {
            const prefix = expandedPattern.slice(0, -3) // Remove "/**"
            return scope.startsWith(prefix + '/') || scope === prefix
        }
        
        // Exact match
        return scope === expandedPattern
    })
}

/**
 * Check if any of the provided scopes should be logged based on debug configuration
 * @param scopes Array of scopes to check
 * @param config Debug configuration
 * @returns true if any scope matches the debug configuration
 */
function shouldLog(scopes: string[], config: DebugConfig): boolean {
    // If debug is disabled (no patterns), don't log
    if (!config.patterns.length && !config.enableAll) {
        return false
    }
    
    // If enableAll is true (contains "*"), log everything
    if (config.enableAll) {
        return true
    }
    
    // Check if any scope matches any pattern
    return scopes.some(scope => 
        config.patterns.some(pattern => matchesPattern(scope, pattern))
    )
}

/**
 * Debug logging function
 * @param scopes A single scope string or array of scope strings (e.g., "middleware/auth" or ["middleware/auth", "api/test"])
 * @param args Additional arguments to log
 */
export function debug(scopes: string | string[], ...args: unknown[]): void {
    if (!env) {
        console.warn('Environment variables not available for debug logging')
        return
    }
    
    const scopeArray = Array.isArray(scopes) ? scopes : [scopes]
    const debugConfig = env.NEXT_PUBLIC_DEBUG
    
    if (shouldLog(scopeArray, debugConfig)) {
        const scopeStr = scopeArray.join(', ')
        const timestamp = new Date().toISOString()
        
        console.log(
            `${YELLOW}[DEBUG]${RESET} [${timestamp}] ${PURPLE}[${scopeStr}]${RESET}`,
            ...args
        )
    }
}

/**
 * Create a debug function bound to specific scopes
 * @param scopes The scopes to bind to this debug instance
 * @returns A debug function that will always use the provided scopes
 */
export function createDebug(scopes: string | string[]) {
    return (...args: unknown[]) => debug(scopes, ...args)
}

/**
 * Check if debug is enabled for specific scopes (useful for expensive operations)
 * @param scopes A single scope string or array of scope strings
 * @returns true if debug is enabled for any of the provided scopes
 */
export function isDebugEnabled(scopes: string | string[]): boolean {
    if (!env) {
        return false
    }
    
    const scopeArray = Array.isArray(scopes) ? scopes : [scopes]
    const debugConfig = env.NEXT_PUBLIC_DEBUG
    
    return shouldLog(scopeArray, debugConfig)
}

// Export some commonly used debug instances for convenience
export const middlewareDebug = createDebug('middleware')
export const apiDebug = createDebug('api')
export const authDebug = createDebug('auth')