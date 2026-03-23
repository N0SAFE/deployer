import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import * as path from "path";
import { envSchema } from "./env";
import { EnvService } from "./env.service";

@Global()
@Module({
    imports: [
        ConfigModule.forRoot({
            validate: (env) => envSchema.parse(env),
            isGlobal: true,
            envFilePath: [
                path.resolve(process.cwd(), ".env"),
                path.resolve(process.cwd(), "..", "..", ".env"),
            ],
            ignoreEnvFile: false,
            expandVariables: true,
            cache: true,
        }),
    ],
    providers: [EnvService],
    exports: [EnvService],
})
export class EnvModule {}