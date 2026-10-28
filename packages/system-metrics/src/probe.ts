import { Effect } from "effect";
import * as systeminformation from "systeminformation";

import { MetricsUnavailable } from "./errors";

import type { Readings } from "./readings";

/** How the machine is read. The live one samples `systeminformation`; a test supplies its own. */
export type MachineProbe = Effect.Effect<Readings, MetricsUnavailable>;

/** Samples every reading in parallel. Interrupting it stops waiting; `systeminformation` offers no way to cancel a sample. */
export const systeminformationProbe: MachineProbe = Effect.tryPromise({
	try: async (): Promise<Readings> => {
		const [cpu, load, mem, fsSize, networkStats, graphics, processes] = await Promise.all([
			systeminformation.cpu(),
			systeminformation.currentLoad(),
			systeminformation.mem(),
			systeminformation.fsSize(),
			systeminformation.networkStats(),
			systeminformation.graphics(),
			systeminformation.processes(),
		]);
		return { cpu, load, mem, fsSize, networkStats, graphics, processes };
	},
	catch: (cause) =>
		new MetricsUnavailable({ reason: `Could not read the machine's metrics: ${cause instanceof Error ? cause.message : String(cause)}` }),
});
