import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { appContract } from "@repo/api-contracts";
import { ServiceService } from "../services/service.service";
import { requireAuth } from "@/core/modules/auth/orpc/middlewares";

@Controller()
export class ServiceController {
    constructor(private readonly serviceService: ServiceService) {}

    @Implement(appContract.service.crud.list)
    list() {
        return implement(appContract.service.crud.list)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.serviceService.listServices(input.query);
            });
    }

    @Implement(appContract.service.crud.findById)
    findById() {
        return implement(appContract.service.crud.findById)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.serviceService.getServiceById(input.params.id);
            });
    }

    @Implement(appContract.service.crud.create)
    create() {
        return implement(appContract.service.crud.create)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                const service = await this.serviceService.createService(input, context.auth.user.id);
                return { status: 201 as const, headers: {}, body: service };
            });
    }

    @Implement(appContract.service.crud.update)
    update() {
        return implement(appContract.service.crud.update)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                const { id, ...data } = input;
                return this.serviceService.updateService(id, data, context.auth.user.id);
            });
    }

    @Implement(appContract.service.crud.delete)
    delete() {
        return implement(appContract.service.crud.delete)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                await this.serviceService.deleteService(input.params.id, context.auth.user.id);
                return { success: true };
            });
    }

    @Implement(appContract.service.lifecycle.toggleActive)
    toggleActive() {
        return implement(appContract.service.lifecycle.toggleActive)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                return this.serviceService.toggleActive(input.id, input.isActive, context.auth.user.id);
            });
    }

    @Implement(appContract.service.dependencies.list)
    getDependencies() {
        return implement(appContract.service.dependencies.list)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.serviceService.getDependencies(input.id);
            });
    }

    @Implement(appContract.service.dependencies.add)
    addDependency() {
        return implement(appContract.service.dependencies.add)
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

    @Implement(appContract.service.dependencies.remove)
    removeDependency() {
        return implement(appContract.service.dependencies.remove)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                await this.serviceService.removeDependency(input.id, input.dependencyId, context.auth.user.id);
                return { success: true };
            });
    }

    @Implement(appContract.service.streams.query)
    streamQuery() {
        const serviceService = this.serviceService;

        return implement(appContract.service.streams.query)
            .use(requireAuth())
            .handler(({ input }) => {
                return serviceService.streamQueryEvents(input.query);
            });
    }
}
