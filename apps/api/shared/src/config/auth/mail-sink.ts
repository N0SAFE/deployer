import { Logger } from "@nestjs/common";

import type { MailSink } from "@deployer/auth/mail";

const logger = new Logger("AuthMail");

/**
 * The deployment's mail transport (`AUTH-015`).
 *
 * One HTTP relay, provider-agnostic: `MAIL_WEBHOOK_URL` receives `{ to, subject, text, kind }` as JSON, so Resend,
 * Postmark, a sidecar or an internal service all plug in without this package knowing their API.
 *
 * Without it, development logs the message (a reset link nobody can read is a dead end) and production returns NO sink —
 * Better Auth still answers the request the same way (no account enumeration), but nobody is told an email was sent.
 */
export function makeMailSink(options: { url: string | undefined; nodeEnv: string | undefined }): MailSink | undefined {
	if (options.url !== undefined && options.url.length > 0) {
		const url = options.url;
		return {
			send: async (message) => {
				const response = await fetch(url, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(message),
				});
				if (!response.ok) {
					throw new Error(`mail relay answered ${String(response.status)}`);
				}
			},
		};
	}

	if (options.nodeEnv !== "production") {
		return {
			send: (message) => {
				logger.warn(`[dev mail] to=${message.to} subject="${message.subject}"\n${message.text}`);
				return Promise.resolve();
			},
		};
	}

	return undefined;
}
