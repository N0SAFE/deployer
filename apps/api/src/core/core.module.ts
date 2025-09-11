import { Module } from '@nestjs/common';
import { DockerService } from './services/docker.service';
import { GitService } from './services/git.service';
import { StaticFileService } from './services/static-file.service';
import { DeploymentService } from './services/deployment.service';
import { DeploymentHealthMonitorService } from './services/deployment-health-monitor.service';
import { TraefikModule } from '../modules/traefik/traefik.module';

@Module({
    imports: [TraefikModule],
    providers: [
        DockerService,
        GitService,
        StaticFileService,
        DeploymentService,
        DeploymentHealthMonitorService,
    ],
    exports: [
        DockerService,
        GitService,
        StaticFileService,
        DeploymentService,
        DeploymentHealthMonitorService,
    ],
})
export class CoreModule {
}
