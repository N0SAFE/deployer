import { Global, Module } from "@nestjs/common";
import { EnvService } from "./env.service";
import { ConfigModule } from "@nestjs/config";
import { envSchema } from "./env";
import { configTrigger, ConfigTriggerService } from "./config.trigger.service";
import * as path from "path";
import * as fs from "fs";

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      validate: (env) => envSchema.parse(env),
      isGlobal: true,
      envFilePath: (() => {
        const paths = [
          path.resolve(process.cwd(), ".env"),
          path.resolve(process.cwd(), "..", "..", ".env"),
        ];
        return paths.filter(p => fs.existsSync(p));
      })(),
      ignoreEnvFile: false,
      expandVariables: true,
      cache: true,
    }),
  ],
  providers: [
    EnvService,
    { provide: ConfigTriggerService, useValue: configTrigger },
  ],
  exports: [EnvService, ConfigModule, ConfigTriggerService],
})
export class EnvModule {}
