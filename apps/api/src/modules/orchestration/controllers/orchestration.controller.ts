import { Controller, Logger } from '@nestjs/common';

/**
 * DEPRECATED
 *
 * This controller contained legacy, mock-based implementations for orchestration
 * endpoints. The real, service-backed implementations have been migrated to
 * `OrchestrationOrpcController` (type-safe ORPC) and `OrchestrationRestController`.
 *
 * We keep this file for historical reference but remove the legacy mock
 * handlers to avoid duplication and to reduce technical debt.
 */
@Controller()
export class OrchestrationController {
    private readonly logger = new Logger(OrchestrationController.name);
    constructor() {
        this.logger.warn('OrchestrationController is deprecated and no longer exposes operational endpoints. Use OrchestrationOrpcController or OrchestrationRestController.');
    }
}
