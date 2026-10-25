import { describe, expect, it } from "vitest";

import { shellQuote } from "../cli";

/**
 * Shell quoting for `--command`.
 *
 * These assertions exist because the first `Bun.$` migration dropped the quoting
 * entirely (`command.join(" ")`) and silently changed what a user's command MEANT:
 *
 *   ["bash", "-c", "exit 7"].join(" ")  →  "bash -c exit 7"
 *
 * which bash reads as "run the script named `exit` with `$0` = 7" — it exits 0 and
 * does nothing. The failure was invisible: no error, no output, wrong exit code.
 */
describe("shellQuote", () => {
    it("leaves a plain word alone", () => {
        expect(shellQuote("echo")).toBe("echo");
        expect(shellQuote("build:types")).toBe("build:types");
        expect(shellQuote("a/b@c=1")).toBe("a/b@c=1");
    });

    it("quotes a word with spaces, preserving the argument boundary", () => {
        expect(shellQuote("exit 7")).toBe("'exit 7'");
        expect(shellQuote("--flag=two words")).toBe("'--flag=two words'");
    });

    it("quotes shell metacharacters instead of letting them run", () => {
        expect(shellQuote("a;b")).toBe("'a;b'");
        expect(shellQuote("a && b")).toBe("'a && b'");
        expect(shellQuote("$(whoami)")).toBe("'$(whoami)'");
        expect(shellQuote("`id`")).toBe("'`id`'");
    });

    it("escapes an embedded single quote rather than terminating the string", () => {
        // `'` closes, `\'` escapes, `'` reopens — the POSIX form.
        expect(shellQuote("it's")).toBe(`'it'\\''s'`);
    });

    it("renders an empty word as an explicit empty argument", () => {
        // Without this, `.join(" ")` collapses and the argument disappears.
        expect(shellQuote("")).toBe("''");
    });

    /**
     * The end-to-end shape the bug produced. `bash -c 'exit 7'` must survive as
     * THREE words with the third still quoted.
     */
    it("keeps a multi-word -c argument as one quoted word", () => {
        const quoted = ["bash", "-c", "exit 7"].map(shellQuote).join(" ");

        expect(quoted).toBe("bash -c 'exit 7'");
    });
});
