import type { LocalDb } from '@deployer/node-state'
import { Logger } from '@nestjs/common'

export function seedLocal(_localDb: LocalDb) {
    const logger = new Logger('seedLocal')
    logger.log('📦 Applying local seed...')
    // Currently nothing to seed locally
    logger.log('✅ Local Database seeded successfully')
}
