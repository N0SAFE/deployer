/**
 * Deterministic date/time formatting for the web app.
 *
 * WHY THIS EXISTS
 * ---------------
 * `new Date(x).toLocaleString()` with no arguments is a hydration bug. It resolves
 * the locale AND the time zone from the runtime environment, so the server (an
 * Alpine container, usually UTC, no user locale) and the browser (the operator's
 * own machine) can render the same timestamp as different text. React then finds
 * the server's HTML disagreeing with the client's first render and throws:
 *
 *   "Hydration failed because the server rendered text didn't match the client.
 *    As a result this tree will be regenerated on the client."
 *
 * It surfaced on /dashboard/admin/system, but the pattern was spread across
 * thirteen dashboard pages, so every timestamp in the console was a coin flip
 * between one rendering and two.
 *
 * The fix is to pin BOTH: an explicit locale for a stable field order and an
 * explicit `UTC` for a stable clock. Pinning only the locale (as one of the older
 * helpers did) still leaves the time zone — and therefore the hour — up to the
 * environment, which is enough to break hydration on its own.
 *
 * Times are shown in UTC and LABELLED as such. That is deliberate rather than
 * incidental: this console manages nodes across regions, and an unlabelled local
 * time reads as the time on the machine you happen to be looking from. An
 * operator correlating a deployment across two nodes needs one clock.
 */

const LOCALE = "en-US";
const TIME_ZONE = "UTC";

const dateTimeFormatter = new Intl.DateTimeFormat(LOCALE, {
	year: "numeric",
	month: "short",
	day: "numeric",
	hour: "2-digit",
	minute: "2-digit",
	hour12: false,
	timeZone: TIME_ZONE,
});

const dateFormatter = new Intl.DateTimeFormat(LOCALE, {
	year: "numeric",
	month: "short",
	day: "numeric",
	timeZone: TIME_ZONE,
});

const timeFormatter = new Intl.DateTimeFormat(LOCALE, {
	hour: "2-digit",
	minute: "2-digit",
	hour12: false,
	timeZone: TIME_ZONE,
});

/** Returns `null` when the input is absent or unparseable, so callers choose the placeholder. */
function toDate(value: string | number | Date | null | undefined): Date | null {
	if (value === null || value === undefined || value === "") return null;
	const parsed = value instanceof Date ? value : new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** `"Sep 14, 2026, 14:30 UTC"` — falls back to `fallback` (default `"—"`). */
export function formatDateTime(
	value: string | number | Date | null | undefined,
	fallback = "—",
): string {
	const date = toDate(value);
	return date === null ? fallback : `${dateTimeFormatter.format(date)} UTC`;
}

/** `"Sep 14, 2026"` — falls back to `fallback` (default `"—"`). */
export function formatDate(
	value: string | number | Date | null | undefined,
	fallback = "—",
): string {
	const date = toDate(value);
	return date === null ? fallback : dateFormatter.format(date);
}

/** `"14:30 UTC"` — falls back to `fallback` (default `"—"`). */
export function formatTime(
	value: string | number | Date | null | undefined,
	fallback = "—",
): string {
	const date = toDate(value);
	return date === null ? fallback : `${timeFormatter.format(date)} UTC`;
}
