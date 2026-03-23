import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { setupContract } from "@repo/api-contracts";
import { publicAccess } from "@/core/modules/auth/orpc/middlewares";
import { SetupService } from "../services/setup.service";

@Controller()
export class SetupController {
    constructor(private readonly setupService: SetupService) {}

    @Implement(setupContract.getStatus)
    getStatus() {
        return implement(setupContract.getStatus)
            .use(publicAccess())
            .handler(async () => {
                return this.setupService.getSetupState();
            });
    }

    @Implement(setupContract.getStateMachine)
    getStateMachine() {
        return implement(setupContract.getStateMachine)
            .use(publicAccess())
            .handler(() => {
                return this.setupService.getStateMachine();
            });
    }

    @Implement(setupContract.initialize)
    initialize() {
        return implement(setupContract.initialize)
            .use(publicAccess())
            .handler(async ({ input }) => {
                return this.setupService.initialize(input);
            });
    }

    @Implement(setupContract.configureDatabase)
    configureDatabase() {
        return implement(setupContract.configureDatabase)
            .use(publicAccess())
            .handler(async ({ input }) => {
                return this.setupService.configureDatabaseUrl(input);
            });
    }

    @Implement(setupContract.getNodeStatus)
    getNodeStatus() {
        return implement(setupContract.getNodeStatus)
            .use(publicAccess())
            .handler(() => {
                return this.setupService.getNodeStatus();
            });
    }
}