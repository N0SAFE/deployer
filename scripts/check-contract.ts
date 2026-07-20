import { setupContract } from "../packages/contracts/api/src";
import { isContractProcedure, getEventIteratorSchemaDetails } from "@orpc/contract";

const endpoints = ["initialize", "getInitializeStream", "triggerInitialize"];

for (const name of endpoints) {
    const proc = (setupContract as Record<string, unknown>)[name];
    const isProc = isContractProcedure(proc);
    const def = isProc ? (proc as { "~orpc": { outputSchema?: unknown; inputSchema?: unknown } })["~orpc"] : null;
    
    console.log(`\n=== ${name} ===`);
    console.log(`isContractProcedure: ${isProc}`);
    
    if (def?.outputSchema) {
        const os = def.outputSchema as { "~standard"?: Record<PropertyKey, unknown> };
        const symbolKeys = os["~standard"] ? Object.getOwnPropertySymbols(os["~standard"]) : [];
        console.log(`outputSchema symbols: ${symbolKeys.map(s => s.toString()).join(", ") || "none"}`);
        
        const ei = getEventIteratorSchemaDetails(os);
        console.log(`getEventIteratorSchemaDetails: ${ei !== undefined}`);
        
        const shape = (os as unknown as Record<string, unknown>)["_shape"] as Record<string, unknown> | undefined;
        if (shape && typeof shape === "object") {
            console.log(`shape keys: ${Object.keys(shape).join(", ")}`);
            if ("body" in shape) {
                const bodyStd = (shape["body"] as Record<string, unknown>)?.["~standard"] as Record<PropertyKey, unknown> | undefined;
                if (bodyStd) {
                    const bodySymbols = Object.getOwnPropertySymbols(bodyStd);
                    console.log(`body ~standard symbols: ${bodySymbols.map(s => s.toString()).join(", ") || "none"}`);
                }
            }
        }
    }
}
