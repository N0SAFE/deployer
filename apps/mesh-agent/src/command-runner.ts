/**
 * Run a host command and capture its output — the agent's only way into the kernel
 * (`ip`, `wg`). Injected everywhere so tests never spawn a process.
 *
 * Uses `Bun.spawn` rather than `node:child_process.spawn`: the agent already runs
 * on Bun, and `Bun.spawn` returns the exit code and collectable pipes without an
 * event-listener dance. No shell is involved either way, so arguments are never
 * interpreted and nothing can be injected.
 */

export type CommandResult = {
	code: number;
	stdout: string;
	stderr: string;
}

export type CommandRunner = (command: string, args: readonly string[]) => Promise<CommandResult>;

export async function spawnCommand(command: string, args: readonly string[]): Promise<CommandResult> {
	try {
		const proc = Bun.spawn([command, ...args], {
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});

		// Drain both pipes CONCURRENTLY with waiting for the exit: reading them
		// sequentially can deadlock once either pipe's OS buffer fills, which is
		// exactly what happens for a chatty `ip` or `wg` invocation.
		const [stdout, stderr, code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);

		return { code, stdout, stderr };
	} catch (error: unknown) {
		// A missing binary throws in `Bun.spawn` rather than reporting an exit code.
		// 127 is the shell's convention for "command not found", which is what every
		// caller already handles.
		const message = error instanceof Error ? error.message : String(error);
		return { code: 127, stdout: "", stderr: message };
	}
}
