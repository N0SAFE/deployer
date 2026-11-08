import { createModuleContext } from '@deployer/nest-effect'

import { DatabasePort } from '@identity/core/database/database.port'
import { AuditDomainModule } from '@identity/modules/audit/audit.module'
import { StepUpDomainModule } from '@identity/modules/step-up/step-up.module'

import { ApprovalRepository } from './approval.repository'

import type { ApprovalRepositoryShape } from './approval.repository'
import { ApprovalService } from './approval.service'
import { ApprovalController } from './controllers/approval.controller'

/** Approvals (`SEC-072`): the ledger and its decide/consume surface. */
export class ApprovalDomainModule extends createModuleContext(
    {
        controllers: [ApprovalController],
        exports: [ApprovalService, ApprovalRepository],
        imports: [StepUpDomainModule, AuditDomainModule],
        providers: [
            // The service takes its repository as a constructor argument (see the class doc).
            {
                provide: ApprovalService,
                useFactory: (repository: ApprovalRepositoryShape) =>
                    new ApprovalService.live(repository),
                inject: [ApprovalRepository],
            },
            { provide: ApprovalRepository, useValue: ApprovalRepository.live },
        ],
    },
    DatabasePort
) {}
