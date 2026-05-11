import { oc } from "@orpc/contract";
import { dockerContainerTerminalOpenContract } from "./open";
import { dockerContainerTerminalStreamContract } from "./stream";
import { dockerContainerTerminalInputContract } from "./input";
import { dockerContainerTerminalCloseContract } from "./close";

export const dockerContainerTerminalContract = oc
  .tag("Docker Container Terminal")
  .prefix("/terminal")
  .router({
    open: dockerContainerTerminalOpenContract,
    stream: dockerContainerTerminalStreamContract,
    sendInput: dockerContainerTerminalInputContract,
    close: dockerContainerTerminalCloseContract,
  });

export {
  dockerContainerTerminalOpenContract,
  dockerContainerTerminalStreamContract,
  dockerContainerTerminalInputContract,
  dockerContainerTerminalCloseContract,
};
