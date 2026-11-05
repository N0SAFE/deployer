import { Logger, Inject } from '@nestjs/common'
import { Command, CommandRunner } from 'nest-commander'

import { LocalDatabase, type LocalDatabaseShape } from '@deployer/node-state'

import { resetLocal } from './local'

@Command({
    name: 'reset',
    description:
        'Reset the database by dropping and recreating the public schema',
})
export class ResetCommand extends CommandRunner {
    private readonly logger = new Logger(ResetCommand.name)

    constructor(
        @Inject(LocalDatabase)
        private readonly localDatabase: LocalDatabaseShape
    ) {
        super()
    }

    run() {
        try {
            resetLocal(this.localDatabase.db)

            this.logger.log(`✅ Finished reset operation`)
        } catch (error) {
            this.logger.error('❌ Reset failed:', error)
            throw error
        }
        return Promise.resolve()
    }
}
