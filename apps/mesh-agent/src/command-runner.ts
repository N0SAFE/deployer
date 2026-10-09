/**
 * Run a host command and capture its output — the agent's only way into the kernel
 * (`ip`, `wg`). Injected everywhere so tests never spawn a process.
 */

import { spawn } from "node:child_process";

export type CommandResult = {
	code: number;
	stdout: string;
	stderr: string;
}

export type CommandRunner = (command: string, args: readonly string[]) => Promise<CommandResult>;

/** Spawn without a shell — arguments are never interpreted, so nothing can be injected. */
export const spawnCommand: CommandRunner = (command, args) =>
	new Promise((resolve) => {
		const child = spawn(command, [...args], { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on("error", (error) => {
			resolve({ code: 127, stdout, stderr: `${stderr}${error.message}` });
		});
		child.on("close", (code) => {
			resolve({ code: code ?? 1, stdout, stderr });
		});
	});
