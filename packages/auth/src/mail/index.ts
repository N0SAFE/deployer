/**
 * Outbound mail (`AUTH-015`).
 *
 * A port, not a provider: the deployment supplies the transport (an HTTP relay, a transactional-email API, SMTP behind a
 * sidecar), and the auth package only decides WHAT to say. Absent means "this deployment has no mail" — the callers
 * degrade explicitly instead of silently claiming a message was sent.
 */
export type MailKind = "password-reset" | "email-change" | "invite" | "other";

export interface MailMessage {
	readonly to: string;
	readonly subject: string;
	readonly text: string;
	/** What the message is for, so a transport can route or template it. */
	readonly kind: MailKind;
}

export interface MailSink {
	send(message: MailMessage): Promise<void>;
}
