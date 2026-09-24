import { logger } from '@repo/logger'

const setupLogger = logger.scope('SetupStorage')

/**
 * localStorage contract shared between the setup wizard and the post-setup
 * hint queue.
 *
 * The key lives here rather than inline at each call site because the writers
 * (two different wizard components) and the reader (the dashboard hint queue)
 * are in different folders: a typo in any one copy would disable the hint queue
 * silently, with no error and nothing to search for.
 */

/**
 * Written by the wizard once initial setup completes. The dashboard hint queue
 * consumes it and clears it, so the hints appear exactly once per install.
 */
export const SETUP_COMPLETE_KEY = 'post-setup-complete'

/**
 * Flag that the install finished, so the hint queue shows on the next dashboard
 * load.
 *
 * localStorage throws in private-browsing modes and once the origin quota is
 * exhausted. Neither is worth failing a completed setup over — but neither is
 * worth hiding either: a silent catch here is exactly how "the hints never
 * appear" turns into an unexplainable bug report.
 */
export function markSetupComplete(): void {
	try {
		window.localStorage.setItem(SETUP_COMPLETE_KEY, '1')
	} catch (error) {
		setupLogger.warn('Could not persist the setup-complete flag', { error })
	}
}
