import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { appContract } from "@repo/api-contracts";
import { ServiceService } from "../services/service.service";
import { requireAuth } from "@/core/modules/auth/orpc/middlewares";
import { observableToAsyncIterable } from "@/core/utils/observable.utils";

@Controller()
export class ServiceController {
    constructor(private readonly serviceService: ServiceService) {}

    @Implement(appContract.service.list)
    list() {
        return implement(appContract.service.list)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.serviceService.listServices(input.query);
            });
    }

    @Implement(appContract.service.findById)
    findById() {
        return implement(appContract.service.findById)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.serviceService.getServiceById(input.params.id);
            });
    }

    @Implement(appContract.service.create)
    create() {
        return implement(appContract.service.create)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                const service = await this.serviceService.createService(input, context.auth.user.id);
                return { status: 201 as const, headers: {}, body: service };
            });
    }

    @Implement(appContract.service.update)
    update() {
        return implement(appContract.service.update)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                const { id, ...data } = input;
                return this.serviceService.updateService(id, data, context.auth.user.id);
            });
    }

    @Implement(appContract.service.delete)
    delete() {
        return implement(appContract.service.delete)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                await this.serviceService.deleteService(input.params.id, context.auth.user.id);
                return { success: true };
            });
    }

    @Implement(appContract.service.toggleActive)
    toggleActive() {
        return implement(appContract.service.toggleActive)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                return this.serviceService.toggleActive(input.id, input.isActive, context.auth.user.id);
            });
    }

    @Implement(appContract.service.getDependencies)
    getDependencies() {
        return implement(appContract.service.getDependencies)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.serviceService.getDependencies(input.id);
            });
    }

    @Implement(appContract.service.addDependency)
    addDependency() {
        return implement(appContract.service.addDependency)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                return this.serviceService.addDependency(
                    input.id,
                    input.dependsOnServiceId,
                    input.isRequired,
                    context.auth.user.id,
                );
            });
    }

    @Implement(appContract.service.removeDependency)
    removeDependency() {
        return implement(appContract.service.removeDependency)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                await this.serviceService.removeDependency(input.id, input.dependencyId, context.auth.user.id);
                return { success: true };
            });
    }

    @Implement(appContract.service.streamQuery)
    streamQuery() {
        const serviceService = this.serviceService;

        return implement(appContract.service.streamQuery)
            .use(requireAuth())
            .handler(({ input }) => {
                return observableToAsyncIterable(serviceService.streamQueryEvents(input.query));
            });
    }
}
