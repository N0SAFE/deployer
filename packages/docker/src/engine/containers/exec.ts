import type Docker from "dockerode";
import { Effect } from "effect";
import { PassThrough } from "node:stream";

import { engineMessage } from "../../errors/classify";
import { DockerUnavailable, type DockerError } from "../../errors/errors";
import { engineCall } from "../call";
import { extractInlineOutput, isReadableStream, isWritableStream } from "./streams";

export type ExecResult = { readonly exitCode: number; readonly output: string };

export type ExecShape = {
	/**
	 * Runs `cmd` in a running container and returns its combined stdout and stderr. A non-zero exit
	 * is a failure carrying the output. `input` is written to the command's stdin.
	 */
	readonly run: (idOrName: string, cmd: string[], input?: string) => Effect.Effect<ExecResult, DockerError>;
	/**
	 * Like `run`, but a non-zero exit is data, not a failure: scanners exit non-zero when they find
	 * something. Never fails: a command that could not run reports `exitCode: -1` and the reason.
	 */
	readonly capture: (idOrName: string, cmd: string[], input?: string) => Effect.Effect<ExecResult>;
};

export function makeExec(client: Docker): ExecShape {
	/** One exec: create, start, collect the output, read the exit code. */
	const once = (idOrName: string, cmd: string[], input: string | undefined, hijack: boolean): Promise<ExecResult> =>
		(async () => {
			const exec = await client.getContainer(idOrName).exec({
				Cmd: cmd,
				AttachStdout: true,
				AttachStderr: true,
				AttachStdin: input !== undefined && input.length > 0,
			});
			const hasInput = input !== undefined && input.length > 0;
			const raw: unknown = await exec.start({ hijack, stdin: hasInput });
			const exitCodeOf = async () => {
				const inspected = await exec.inspect();
				return typeof inspected.ExitCode === "number" ? inspected.ExitCode : -1;
			};

			const inline = extractInlineOutput(raw);
			if (inline !== null) return { exitCode: await exitCodeOf(), output: inline };
			if (!isWritableStream(raw) && !isReadableStream(raw)) {
				throw new Error("exec.start() returned an unexpected non-stream value");
			}

			const stdout = new PassThrough();
			const stderr = new PassThrough();
			let output = "";
			try {
				client.modem.demuxStream(raw, stdout, stderr);
			} catch {
				// Not multiplexed: read the raw stream as stdout.
				raw.on("data", (chunk: Buffer) => stdout.write(chunk));
			}
			stdout.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
			stderr.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));

			if (hasInput) {
				if (!isWritableStream(raw)) throw new Error("exec.start() returned a non-writable stream while stdin input was provided");
				raw.write(input);
				raw.end();
			}

			await new Promise<void>((resolve, reject) => {
				raw.on("end", resolve);
				raw.on("close", resolve);
				raw.on("error", reject);
			});
			return { exitCode: await exitCodeOf(), output };
		})();

	/**
	 * Some transports and proxies refuse the hijack upgrade (`HTTP code 101`) but stream fine
	 * without it, so that one failure is retried once without hijack.
	 */
	const attemptExec = (idOrName: string, cmd: string[], input: string | undefined) =>
		engineCall(`exec in container ${idOrName}`, () => once(idOrName, cmd, input, true)).pipe(
			Effect.catch((failure) =>
				/http code\s*101/i.test(engineMessage(failure.cause ?? failure))
					? engineCall(`exec in container ${idOrName} (without hijack)`, () => once(idOrName, cmd, input, false))
					: Effect.fail(failure),
			),
		);

	return {
		run: Effect.fn("DockerExec.run")(function* (idOrName, cmd, input) {
			const result = yield* attemptExec(idOrName, cmd, input);
			if (result.exitCode !== 0) {
				return yield* Effect.fail(
					new DockerUnavailable({
						reason: `Command ${cmd.join(" ")} failed with exit code ${String(result.exitCode)} - output: ${result.output}`,
					}),
				);
			}
			return result;
		}),

		capture: Effect.fn("DockerExec.capture")(function* (idOrName, cmd, input) {
			return yield* attemptExec(idOrName, cmd, input).pipe(
				Effect.catch((failure) => Effect.succeed({ exitCode: -1, output: engineMessage(failure) })),
			);
		}),
	};
}
