import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { logsContract } from "../../contracts/stream.contract";
import { LogStream } from "./services/log-stream.service";

@Controller()
export class StreamController {
  @Implement(logsContract.stream)
  stream() {
    return implement(logsContract.stream).effect(function* ({ input }) {
      const logs = yield* LogStream;

      // Observable travels untouched; `RxJSHandlerPlugin` streams it as SSE.
      return yield* logs.stream(input);
    });
  }
}
