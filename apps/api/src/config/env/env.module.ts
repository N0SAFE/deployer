import { Global, Module } from "@nestjs/common";
import { EnvService } from "./env.service";
import { ConfigModule } from "@nestjs/config";
import { envSchema } from "./env";
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
        // Only return paths that actually exist
        return paths.filter(p => fs.existsSync(p));
      })(),
      ignoreEnvFile: false,
      expandVariables: true,
      cache: true,
    }),
  ],
  providers: [EnvService],
  exports: [EnvService, ConfigModule],
})
export class EnvModule {}
