import { Logger, Module } from '@nestjs/common'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as globalSchema from '@/config/drizzle/global/schema'
import { GLOBAL_DATABASE_CONNECTION, GLOBAL_DATABASE_POOL } from '../database-connection'
import { GlobalDatabaseService } from './global-database.service'
import { InitializationService } from '../../setup/services/initialization.service';
import { CoreInitializationModule } from '../../setup/initialization.module';

const logger = new Logger('GlobalModule')

@Module({
    imports: [
        CoreInitializationModule,
    ],
    providers: [
        {
            provide: GLOBAL_DATABASE_POOL,
            useFactory: async (InitializationService: InitializationService): Promise<Pool> => {
                console.log('⏳ Waiting for setup to complete before opening DB pool…')

                const { databaseUrl, nodeId, strategy } = await InitializationService.waitForSetup()

                if (!databaseUrl) {
                    throw new Error(
                        `Setup completed (nodeId=${nodeId}, strategy=${strategy}) but databaseUrl is empty. ` +
                        'Make sure InitializationService.emitCompleted() receives the correct databaseUrl.',
                    )
                }

                logger.log(`✅ Setup complete — opening Postgres pool (strategy=${strategy})`)
                return new Pool({ connectionString: databaseUrl })
            },
            inject: [InitializationService],
        },
        {
            provide: GLOBAL_DATABASE_CONNECTION,
            useFactory: (pool: Pool) => {
                return drizzle(pool, { schema: globalSchema })
            },
            inject: [GLOBAL_DATABASE_POOL],
        },
        {
            provide: GlobalDatabaseService,
            useFactory: (db: ReturnType<typeof drizzle<typeof globalSchema>>) => {
                return new GlobalDatabaseService(db)
            },
            inject: [GLOBAL_DATABASE_CONNECTION],
        },
    ],
    exports: [GlobalDatabaseService, GLOBAL_DATABASE_CONNECTION, GLOBAL_DATABASE_POOL],
})
export class GlobalModule {}