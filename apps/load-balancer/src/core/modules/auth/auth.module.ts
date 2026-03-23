import { Module } from "@nestjs/common";
import { ApiSessionAuthService } from "./services/api-session-auth.service";

@Module({
    providers: [ApiSessionAuthService],
    exports: [ApiSessionAuthService],
})
export class AuthModule {}