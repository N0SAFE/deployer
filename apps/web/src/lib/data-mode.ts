import { AppLogger } from '@repo/logger'

/**
 * Data Mode Configuration
 *
 * Controls whether the application uses mock data or live API.
 * Configure via NEXT_PUBLIC_DATA_MODE environment variable or toggle at runtime.
 */

export type DataMode = 'mock' | 'live'

const dataModeLogger = new AppLogger('web').scope('DataMode')

/**
 * Get current data mode from environment or runtime flag
 */
export function getDataMode(): DataMode {
  // Check runtime flag first (allows toggling in dev tools)
  if (typeof window !== 'undefined' && (window as any).__DATA_MODE__) {
    return (window as any).__DATA_MODE__
  }

  // Check environment variable
  const envMode = process.env.NEXT_PUBLIC_DATA_MODE as DataMode | undefined
  if (envMode === 'mock' || envMode === 'live') {
    return envMode
  }

  // Default to mock for development, live for production
  return process.env.NODE_ENV === 'development' ? 'mock' : 'live'
}

/**
 * Set data mode at runtime (development only)
 */
export function setDataMode(mode: DataMode): void {
  if (typeof window !== 'undefined') {
    (window as any).__DATA_MODE__ = mode
    dataModeLogger.debug(`[Data Mode] Switched to ${mode}`)
    // Force page refresh to load new data
    window.location.reload()
  }
}

/**
 * Check if using mock data
 */
export function isUsingMockData(): boolean {
  return getDataMode() === 'mock'
}
