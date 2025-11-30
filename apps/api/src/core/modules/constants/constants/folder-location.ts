import type { EnvService } from "@/config/env/env.service";

export default (envService: EnvService) =>
  ({
    UPLOAD_DIR: "/app/uploads",
    EXTRACT_DIR: "/app/extracted",
    STATIC_FILES_DIR: "/app/static",
    BACKUP_BASE_PATH: envService.get("BACKUP_PATH"),
    STORAGE_BASE_PATH: envService.get("STORAGE_PATH"),
  });
