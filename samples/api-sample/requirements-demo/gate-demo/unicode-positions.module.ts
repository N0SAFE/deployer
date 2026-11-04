import { createModuleContext } from "../src/effect";
import { DirectoryReaderController } from "../src/modules/consumer/controllers/directory-reader.controller";

// éàü 😀🎉 日本語 — multibyte characters BEFORE the violating call. The compiler and the linter must still agree on
// where it is (UTF-16 columns), or the finding is dropped instead of reported.

/** VIOLATION `requirementFlow`: same gap as `consumer-missing-import`, after non-ASCII text, on a line with emoji 😀. */
export const UnicodePositionsModule = /* 😀日本語 */ createModuleContext({
	controllers: [DirectoryReaderController /* 😀 */],
});
