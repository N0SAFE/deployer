
import {
  Global,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import * as fs from "fs-extra";
import { ConstantsService } from "@/core/modules/constants/services/constants.service";

@Global()
@Injectable()
export class FileUploadBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(FileUploadBootstrap.name);

  constructor(
    private readonly constantsService: ConstantsService
  ) {}

  async onApplicationBootstrap() {
    // Ensure upload directories exist
    await fs.ensureDir(this.constantsService.constants.FOLDER_LOCATION.UPLOAD_DIR);
    await fs.ensureDir(this.constantsService.constants.FOLDER_LOCATION.EXTRACT_DIR);
    this.logger.log("File upload service initialized");
  }
}
