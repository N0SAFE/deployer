import type { ConstantsService } from "@/core/modules/constants/services/constants.service";
import {
  Global,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import * as fs from "fs-extra";

@Global()
@Injectable()
export class StaticProviderInitializer implements OnApplicationBootstrap {
  private readonly logger = new Logger(StaticProviderInitializer.name);

  constructor(
    private readonly constantsService: ConstantsService
  ) {}

  async onApplicationBootstrap() {
    // Ensure static files directory exists
    await fs.ensureDir(this.constantsService.constants.FOLDER_LOCATION.STATIC_FILES_DIR);
    this.logger.log("Static file serving service initialized");
  }
}
