/**
 * The shape vocabulary the screen modules share.
 *
 * ── WHY THESE LIVE IN THE BFF AND NOT IN THE CONTRACT PACKAGE ───────────────
 * The contract declares the RESPONSE shape it serves; these are the internal
 * types the composers build it from. Keeping them separate means the wire contract
 * can change (say, `stats` becoming a map) without every composer following, and a
 * composer can be refactored without touching the public shape.
 *
 * They are declared here rather than beside each composer because the dashboard,
 * the project detail and the fleet overview all produce stats and sections — one
 * definition, three producers, no drift.
 */

/** A count plus the label the UI renders, so the wording has one owner. */
export interface Stat {
	key: string;
	label: string;
	value: number;
	/** Set when the value could not be read, so a card shows WHY not a bare 0. */
	unavailableReason?: string;
}

/** A per-source outcome, so one dead dependency degrades instead of failing. */
export interface Section {
	name: string;
	ok: boolean;
	reason?: string;
}
