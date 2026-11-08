import { createModuleContext } from '@deployer/nest-effect'

import { DatabasePort } from '@identity/core/database/database.port'

import { AuditRepository } from './audit.repository'
import { AuditService } from './audit.service'
import { AuditController } from './controllers/audit.controller'
import { DenialAuditInstaller } from './denial-audit.installer'

/** The auth audit log: append-only reads for whoever holds `audit:read`. */
export class AuditDomainModule extends createModuleContext(
    {
        controllers: [AuditController],
        exports: [AuditService, AuditRepository],
        providers: [
            // The service takes its repository as a constructor argument (see the class doc).
            {
                provide: AuditService,
                useFactory: (repository: AuditRepository['Service']) =>
                    new AuditService.live(repository),
                inject: [AuditRepository],
            },
            { provide: AuditRepository, useValue: AuditRepository.live },
            DenialAuditInstaller,
        ],
    },
    DatabasePort
) {}
