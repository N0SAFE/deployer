import { Module } from "@nestjs/common";
import { LogStream, LogStreamServiceImpl } from "./services/log-stream.service";
import { StreamController } from "./stream.controller";

@Module({
  controllers: [StreamController],
  providers: [{ provide: LogStream, useClass: LogStreamServiceImpl }],
})
export class StreamModule {}
