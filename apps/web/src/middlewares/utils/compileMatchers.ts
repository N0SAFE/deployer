import type {
  Matcher,
  MatcherCondition,
  MatcherType,
  Middleware,
} from "./types";

/**
 * Native Next.js Proxy matcher source.
 *
 * Next.js accepts string route sources in `config.matcher`; this utility
 * compiles the project's runtime `Matcher` DSL into those strings.
 */
export type CompiledMatcher = string;

const MATCH_EVERY_PATH = "/:path*";
const MATCH_NO_PATH = "/((?!).*)";

/**
 * Compile the matchers declared by a middleware registry into a union of
 * Next.js Proxy matcher sources.
 *
 * The input is the same `Middleware[]` consumed by `stackMiddlewares`.
 * Entries are ORed together because Next.js treats `config.matcher` as a
 * union: Proxy must run whenever any registered middleware needs a request.
 *
 * Important:
 * - A bare MiddlewareFactory has no matcher metadata, so it is treated as
 *   unconditionally applicable (the same behavior as stackMiddlewares).
 * - A module without a `matcher` is also unconditionally applicable.
 * - Function matchers cannot be converted into static Next.js configuration
 *   and therefore throw instead of silently changing their semantics.
 * - Run this during code generation and emit the returned strings as literals
 *   in `proxy.ts`. Next.js statically analyzes `config.matcher`.
 */
export function compileMatchers(
  middlewares: Middleware[],
): CompiledMatcher[] {
  const compiled = new Set<CompiledMatcher>();

  for (const middleware of middlewares) {
    if (typeof middleware === "function") {
      return [MATCH_EVERY_PATH];
    }

    const matcher = middleware.matcher;

    // A middleware without a matcher runs on every request in the runtime
    // stack, so the global Proxy matcher must not filter those requests out.
    if (matcher === undefined || matcher === true) {
      return [MATCH_EVERY_PATH];
    }

    if (matcher === false) {
      continue;
    }

    for (const node of matcherNodes(matcher)) {
      const body = compileMatcherType(node);

      if (body === "(?!)") {
        continue;
      }

      compiled.add(body === ".*" ? MATCH_EVERY_PATH : `/(${body})`);

      if (body === ".*") {
        return [MATCH_EVERY_PATH];
      }
    }
  }

  // A valid matcher list is needed even when every declared matcher is false.
  return compiled.size > 0 ? [...compiled] : [MATCH_NO_PATH];
}

function matcherNodes(matcher: Matcher): MatcherType[] {
  if (Array.isArray(matcher)) {
    return matcher;
  }

  if (typeof matcher === "boolean") {
    return [matcher];
  }

  if (typeof matcher === "function") {
    throw new TypeError(
      "compileMatchers cannot compile a function matcher. " +
        "Use a declarative MatcherCondition/string/RegExp so it can be " +
        "represented in Next.js config.matcher.",
    );
  }

  if (isMatcherCondition(matcher)) {
    return [matcher];
  }

  // MatcherTypeRecord semantics in stackMiddlewares are OR across values.
  return Object.values(matcher) as MatcherType[];
}

function compileMatcherType(matcher: MatcherType): string {
  if (typeof matcher === "boolean") {
    return matcher ? ".*" : "(?!)";
  }

  if (typeof matcher === "string") {
    // The runtime matcher compares strings for exact pathname equality.
    // Remove the leading slash because Next.js's custom regexp group begins
    // immediately after the mandatory slash in the matcher source.
    if (!matcher.startsWith("/")) {
      return "(?!)";
    }

    return `${escapeRegExp(matcher.slice(1))}$`;
  }

  if (matcher instanceof RegExp) {
    return compileRegExp(matcher);
  }

  if (typeof matcher === "function") {
    throw new TypeError(
      "compileMatchers cannot compile a callback matcher into static " +
        "Next.js config.matcher. Replace it with a declarative matcher.",
    );
  }

  return compileCondition(matcher);
}

function compileCondition(condition: MatcherCondition): string {
  const constraints: string[] = [];

  if (condition.and !== undefined) {
    for (const item of condition.and) {
      constraints.push(`(?=${compileMatcherType(item)})`);
    }
  }

  if (condition.or !== undefined) {
    if (condition.or.length === 0) {
      constraints.push("(?!)");
    } else {
      const alternatives = condition.or
        .map((item) => `(?:${compileMatcherType(item)})`)
        .join("|");

      constraints.push(`(?=(?:${alternatives}))`);
    }
  }

  if (condition.not !== undefined) {
    if (Array.isArray(condition.not)) {
      // Match the current runtime evaluator: an array under "not" means
      // "not all of these match", i.e. negate their conjunction.
      const conjunction = condition.not
        .map((item) => `(?=${compileMatcherType(item)})`)
        .join("");

      constraints.push(`(?!${conjunction})`);
    } else {
      constraints.push(`(?!${compileMatcherType(condition.not)})`);
    }
  }

  return constraints.length > 0 ? `${constraints.join("")}.*` : ".*";
}

function compileRegExp(regexp: RegExp): string {
  if (regexp.flags.length > 0) {
    throw new TypeError(
      `compileMatchers does not support RegExp flags (${regexp.flags}) in ${regexp.toString()}.`,
    );
  }

  let source = regexp.source;
  const anchoredAtStart = source.startsWith("^");

  if (anchoredAtStart) {
    source = source.slice(1);

    // Runtime regexes test the complete pathname (which starts with "/").
    // Next.js's custom regexp group begins after that slash.
    if (source.startsWith("\\/")) {
      source = source.slice(2);
    } else if (source.startsWith("/")) {
      source = source.slice(1);
    } else if (
      !source.startsWith("(?") &&
      !source.startsWith(".*") &&
      !source.startsWith(".")
    ) {
      // For example, /^dashboard$/ never matches a pathname such as
      // "/dashboard" because its required leading slash is missing.
      return "(?!)";
    }
  } else {
    // RegExp.test() searches within the pathname when there is no ^ anchor.
    source = `.*(?:${source}).*`;
  }

  // The runtime regexes commonly exclude a path segment with
  // (?!.*\\/segment). After Next.js consumes the initial slash, that segment
  // can be either at the start of the remaining path or after another slash.
  // Compile that specific leading-search form to preserve both cases.
  source = source.replace(
    /\(\?!\.\*\\\/([^()]*)\)/g,
    (_match, suffix: string) => `(?!${suffix}|.*\\/${suffix})`,
  );

  // A leading .*\/segment can also consume the original leading slash.
  if (source.startsWith(".*\\/")) {
    source = source.replace(/^\.\*\\\//, "(?:.*\\/)?");
  }

  source = source.replaceAll("\\/", "/");
  source = makeGroupsNonCapturing(source);

  if (source.includes("(?<=") || source.includes("(?<!")) {
    throw new TypeError(
      `compileMatchers does not support lookbehind in ${regexp.toString()}.`,
    );
  }

  // Next.js uses path-to-regexp to parse matcher sources. Avoid introducing
  // ordinary capture groups inside its custom regexp group.
  return source || ".*";
}

function makeGroupsNonCapturing(source: string): string {
  let result = "";
  let escaped = false;
  let inCharacterClass = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (escaped) {
      result += character;
      escaped = false;
      continue;
    }

    if (character === "\\") {
      result += character;
      escaped = true;
      continue;
    }

    if (character === "[") {
      inCharacterClass = true;
      result += character;
      continue;
    }

    if (character === "]") {
      inCharacterClass = false;
      result += character;
      continue;
    }

    if (
      character === "(" &&
      !inCharacterClass &&
      source[index + 1] !== "?"
    ) {
      result += "(?:";
      continue;
    }

    result += character;
  }

  return result;
}

function isMatcherCondition(
  matcher: MatcherType | Matcher,
): matcher is MatcherCondition {
  return (
    typeof matcher === "object" &&
    matcher !== null &&
    !(matcher instanceof RegExp) &&
    ("and" in matcher || "or" in matcher || "not" in matcher)
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
