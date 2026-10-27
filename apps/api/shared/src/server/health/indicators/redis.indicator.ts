import { Injectable } from "@nestjs/common";
import { HealthIndicatorService } from "@nestjs/terminus";
import { createConnection, type Socket } from "node:net";

import type { IndicatorResult } from "../types";

/** How long a Redis connect may take before the check calls it down. */
const CONNECT_TIMEOUT_MS = 3_000;

/**
 * The Redis check — a real protocol exchange, not a TCP connect.
 *
 * ── WHY A PING AND NOT `net.connect` ────────────────────────────────────────
 * A TCP connect proves a socket was accepted. A Redis server can accept the
 * socket and still be unusable — loading its dataset from an AOF file after a
 * restart is the common case: it answers TCP, refuses commands with
 * `-LOADING`, and anything the platform relies on Redis for fails. Sending
 * `PING` and requiring `+PONG` is what distinguishes the two.
 *
 * ── WHY THE PROTOCOL IS WRITTEN OUT BY HAND ─────────────────────────────────
 * The alternative is a `redis` client dependency in every service that wants
 * this check, which is a real cost for one command. RESP for `PING` is
 * `*1\r\n$4\r\nPING\r\n`, and the reply is `+PONG` or `-ERR …`; parsing that is
 * less code than wiring a client, and it keeps this indicator dependency-free.
 */
@Injectable()
export class RedisHealthIndicator {
	constructor(private readonly indicator: HealthIndicatorService) {}

	static readonly NAME = "redis";

	async check(): Promise<IndicatorResult> {
		const check = this.indicator.check(RedisHealthIndicator.NAME);

		const url = process.env.DEPLOYER_REDIS_URL;
		if (url === undefined || url === "") {
			// Not configured is not the same as broken. A service that does not use
			// Redis should not declare this indicator at all; one that does and has
			// no URL gets a message naming the variable.
			return check.down({
				message: "DEPLOYER_REDIS_URL is not set",
				hint: "set it, or remove the redis indicator from this service",
			});
		}

		const target = parseRedisUrl(url);
		if (target === undefined) {
			return check.down({ message: `DEPLOYER_REDIS_URL is not a usable URL`, url });
		}

		const started = Date.now();
		try {
			const reply = await ping(target.host, target.port, target.password);
			const latencyMs = Date.now() - started;

			if (reply !== "PONG") {
				return check.down({
					message: `unexpected reply from Redis: ${reply}`,
					latencyMs,
				});
			}
			return check.up({ latencyMs, host: `${target.host}:${String(target.port)}` });
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			return check.down({ message, latencyMs: Date.now() - started });
		}
	}
}

/** `redis://[:password@]host:port[/db]` → connection facts. */
function parseRedisUrl(url: string): { host: string; port: number; password?: string } | undefined {
	try {
		const parsed = new URL(url);
		if (parsed.hostname === "") return undefined;
		const port = parsed.port === "" ? 6379 : Number(parsed.port);
		if (!Number.isInteger(port)) return undefined;
		return {
			host: parsed.hostname,
			port,
			...(parsed.password === "" ? {} : { password: decodeURIComponent(parsed.password) }),
		};
	} catch {
		return undefined;
	}
}

/** Open a socket, optionally authenticate, send PING, return the status word. */
function ping(host: string, port: number, password: string | undefined): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const socket: Socket = createConnection({ host, port });
		let buffer = "";
		let sentPing = false;

		const finish = (error: Error | null, value?: string): void => {
			socket.destroy();
			if (error) reject(error);
			else resolve(value ?? "");
		};

		socket.setTimeout(CONNECT_TIMEOUT_MS);
		socket.once("timeout", () => { finish(new Error(`Redis at ${host}:${String(port)} timed out`)); });
		socket.once("error", (error) => { finish(error); });

		socket.on("data", (chunk: Buffer) => {
			buffer += chunk.toString("utf8");

			// AUTH first when a password is present. Redis replies `+OK`; anything
			// else (usually `-ERR invalid password`) is reported as-is, because the
			// message names the real problem better than we could.
			if (password !== undefined && !sentPing) {
				if (!buffer.includes("\r\n")) return;
				const authReply = buffer.slice(1, buffer.indexOf("\r\n"));
				buffer = "";
				if (!authReply.startsWith("OK")) {
					finish(new Error(`Redis rejected authentication: ${authReply}`));
					return;
				}
				sentPing = true;
				socket.write("PING\r\n");
				return;
			}

			if (!buffer.includes("\r\n")) return;
			const lineEnd = buffer.indexOf("\r\n");
			const reply = buffer.slice(0, lineEnd);
			buffer = buffer.slice(lineEnd + 2);

			if (reply.startsWith("-")) {
				// e.g. `-LOADING Redis is loading the dataset in memory`.
				finish(new Error(reply.slice(1)));
				return;
			}
			// `+PONG` (simple string) or `$4\r\nPONG` (bulk, some proxies).
			finish(null, reply.replace(/^\+\$?\d*\r?\n?/, "").trim() || reply.replace(/^\+/, ""));
		});

		socket.once("connect", () => {
			if (password === undefined) {
				sentPing = true;
				socket.write("PING\r\n");
			} else {
				socket.write(`AUTH ${password}\r\n`);
			}
		});
	});
}
