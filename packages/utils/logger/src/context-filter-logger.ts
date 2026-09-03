import type { LogData, Logger } from "./index";
import { isRecord } from "@repo/type-guards"


/**
 * Type guard that narrows `unknown` to a record-like object so we can
 * index it with string keys.
 */
export type ContextFilterLoggerSource = unknown;

export type ContextFilterLoggerOptions = {
  /**
   * Default class name used when source/context does not provide one.
   */
  defaultClassName?: string;
  /**
   * Optional channel prefix in emitted message.
   */
  channel?: string;
  /**
   * Environment variable containing filter patterns.
   *
   * Examples:
   * - `DockerRuntimeStreamOrchestratorService.stream`
   * - `DockerRuntime*.trace*`
   * - `class:*Relay*`
   * - `method:stream*`
   */
  filterEnvVar?: string;
  /**
   * Optional raw filter value. When provided, it takes precedence over `filterEnvVar`.
   * Useful in browser runtimes where dynamic process.env access is not guaranteed.
   */
  filterValue?: string;
  /**
   * Optional fallback boolean env var to enable all debug logs when no filter is defined.
   */
  fallbackEnableEnvVar?: string;
  /**
   * Optional app/runtime source tag prefixed to sourceName (e.g. "web", "api").
   * Allows cross-app filtering with patterns like `source:web*` and `source:api*`.
   */
  appSourceTag?: string;
  /**
   * Optional env var to resolve `appSourceTag` when not explicitly provided.
   * @default APP_DEBUG_CONTEXT_SOURCE
   */
  appSourceEnvVar?: string;
  /**
   * Sink logger implementation (typically from `@repo/logger`).
   */
  sink: Pick<Logger, "debug">;
};

type ContextFilterPatternKind = "target" | "class" | "method" | "source";

type CompiledContextFilterPattern = {
  raw: string;
  kind: ContextFilterPatternKind;
  matcher: RegExp;
};

type ExtractedSourceIdentity = {
  className?: string;
  methodName?: string;
  sourceName?: string;
};

const DEFAULT_FILTER_ENV_VAR = "APP_DEBUG_CONTEXT_FILTER";
const DEFAULT_APP_SOURCE_ENV_VAR = "APP_DEBUG_CONTEXT_SOURCE";

export class ContextFilterLogger {
  private readonly defaultClassName: string | undefined;
  private readonly channel: string | undefined;
  private readonly sink: Pick<Logger, "debug">;
  private readonly compiledPatterns: CompiledContextFilterPattern[];
  private readonly fallbackEnabled: boolean;
  private readonly appSourceTag: string | undefined;

  constructor(options: ContextFilterLoggerOptions) {
    this.defaultClassName = options.defaultClassName;
    this.channel = options.channel;
    this.sink = options.sink;

    const filterEnvVar = options.filterEnvVar ?? DEFAULT_FILTER_ENV_VAR;
    const resolvedFilterValue = options.filterValue
      ?? ContextFilterLogger.readEnvValue(filterEnvVar);
    this.compiledPatterns = ContextFilterLogger.compilePatterns(resolvedFilterValue);

    this.fallbackEnabled = ContextFilterLogger.readBooleanEnv(
      options.fallbackEnableEnvVar,
    );

    this.appSourceTag = ContextFilterLogger.resolveAppSourceTag(
      options.appSourceTag,
      options.appSourceEnvVar,
    );
  }

  debug(source: ContextFilterLoggerSource, context?: LogData): void {
    const identity = this.extractSourceIdentity(source, context);
    const className = identity.className ?? this.defaultClassName;
    const methodName = identity.methodName;

    const target = this.buildTarget(className, methodName, identity.sourceName);
    if (!this.shouldLog(target, className, methodName, identity.sourceName)) {
      return;
    }

    const message = this.formatMessage(target);
    const payload = this.buildPayload(context, className, methodName, identity.sourceName);

    if (payload) {
      this.sink.debug(message, payload);
      return;
    }

    this.sink.debug(message);
  }

  private shouldLog(
    target: string,
    className: string | undefined,
    methodName: string | undefined,
    sourceName: string | undefined,
  ): boolean {
    if (this.compiledPatterns.length > 0) {
      return this.compiledPatterns.some((pattern) => this.matchesPattern(pattern, target, className, methodName, sourceName));
    }

    return this.fallbackEnabled;
  }

  private matchesPattern(
    pattern: CompiledContextFilterPattern,
    target: string,
    className: string | undefined,
    methodName: string | undefined,
    sourceName: string | undefined,
  ): boolean {
    if (pattern.kind === "class") {
      return typeof className === "string" && pattern.matcher.test(className);
    }

    if (pattern.kind === "method") {
      return typeof methodName === "string" && pattern.matcher.test(methodName);
    }

    if (pattern.kind === "source") {
      return typeof sourceName === "string" && pattern.matcher.test(sourceName);
    }

    return pattern.matcher.test(target)
      || (typeof className === "string" && pattern.matcher.test(className))
      || (typeof methodName === "string" && pattern.matcher.test(methodName))
      || (typeof sourceName === "string" && pattern.matcher.test(sourceName));
  }

  private buildTarget(
    className: string | undefined,
    methodName: string | undefined,
    sourceName: string | undefined,
  ): string {
    if (className && methodName) {
      return `${className}.${methodName}`;
    }

    if (className) {
      return className;
    }

    if (methodName) {
      return methodName;
    }

    return sourceName ?? "unknown";
  }

  private formatMessage(target: string): string {
    if (!this.channel) {
      return target;
    }

    return `[${this.channel}] ${target}`;
  }

  private buildPayload(
    context: LogData | undefined,
    className: string | undefined,
    methodName: string | undefined,
    sourceName: string | undefined,
  ): LogData | undefined {
    const contextWithoutReserved = ContextFilterLogger.stripReservedContextKeys(context);
    const payload: LogData = {
      ...(contextWithoutReserved ?? {}),
      ...(className ? { className } : {}),
      ...(methodName ? { methodName } : {}),
      ...(sourceName ? { sourceName } : {}),
    };

    return Object.keys(payload).length > 0 ? payload : undefined;
  }

  private extractSourceIdentity(
    source: ContextFilterLoggerSource,
    context: LogData | undefined,
  ): ExtractedSourceIdentity {
    const fromContext = this.extractFromContext(context);
    const fromSource = this.extractFromSource(source);

    return {
      className: fromSource.className ?? fromContext.className,
      methodName: fromSource.methodName ?? fromContext.methodName,
      sourceName: this.withAppSourcePrefix(fromSource.sourceName ?? fromContext.sourceName),
    };
  }

  private withAppSourcePrefix(sourceName: string | undefined): string | undefined {
    const appTag = this.appSourceTag?.trim();
    if (!appTag) {
      return sourceName;
    }

    if (!sourceName || sourceName.trim().length === 0) {
      return appTag;
    }

    const normalizedSourceName = sourceName.trim();
    if (normalizedSourceName.toLowerCase().startsWith(`${appTag.toLowerCase()}.`)) {
      return normalizedSourceName;
    }

    return `${appTag}.${normalizedSourceName}`;
  }

  private extractFromContext(context: LogData | undefined): ExtractedSourceIdentity {
    if (!context || typeof context !== "object") {
      return {};
    }

    const className = this.readStringCandidate(context, [
      "className",
      "class",
      "classRef",
      "service",
      "scope",
    ]);

    const methodName = this.readStringCandidate(context, [
      "methodName",
      "method",
      "action",
      "phase",
      "operation",
      "event",
    ]);

    const sourceName = this.readStringCandidate(context, [
      "source",
      "sourceName",
      "eventName",
      "name",
    ]);

    return {
      className,
      methodName,
      sourceName,
    };
  }

  private extractFromSource(source: ContextFilterLoggerSource): ExtractedSourceIdentity {
    if (typeof source === "string") {
      const trimmed = source.trim();
      if (trimmed.length === 0) {
        return {};
      }

      const dotIndex = trimmed.indexOf(".");
      if (dotIndex > 0) {
        const className = trimmed.slice(0, dotIndex).trim();
        const methodName = trimmed.slice(dotIndex + 1).trim();

        return {
          className: className.length > 0 ? className : undefined,
          methodName: methodName.length > 0 ? methodName : undefined,
          sourceName: trimmed,
        };
      }

      return {
        methodName: trimmed,
        sourceName: trimmed,
      };
    }

    if (typeof source === "function") {
      const fnName = source.name.trim();
      return {
        methodName: fnName && fnName.length > 0 ? fnName : undefined,
        sourceName: fnName && fnName.length > 0 ? fnName : "anonymous",
      };
    }

    if (typeof source === "object" && source !== null) {
      const record = isRecord(source) ? source : {};

      const className = this.readStringCandidate(record, [
        "className",
        "class",
        "service",
        "scope",
      ]) ?? this.extractConstructorName(record);

      const methodName = this.readStringCandidate(record, [
        "methodName",
        "method",
        "action",
        "phase",
        "operation",
        "name",
      ]);

      const sourceName = this.readStringCandidate(record, [
        "source",
        "sourceName",
        "eventName",
        "name",
      ]) ?? className;

      return {
        className,
        methodName,
        sourceName,
      };
    }

    return {
      sourceName: String(source),
    };
  }

  private readStringCandidate(source: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = source[key];

      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      }

      if (typeof value === "function") {
        const fnName = value.name.trim();
        if (fnName && fnName.length > 0) {
          return fnName;
        }
      }

      if (typeof value === "object" && value !== null) {
        const constructorName = this.extractConstructorName(isRecord(value) ? value : {});
        if (constructorName) {
          return constructorName;
        }
      }
    }

    return undefined;
  }

  private extractConstructorName(source: Record<string, unknown>): string | undefined {
    const constructorCandidate = source.constructor as { name?: unknown } | undefined;
    if (!constructorCandidate || typeof constructorCandidate.name !== "string") {
      return undefined;
    }

    const constructorName = constructorCandidate.name.trim();
    if (constructorName.length === 0 || constructorName === "Object") {
      return undefined;
    }

    return constructorName;
  }

  private static stripReservedContextKeys(context: LogData | undefined): LogData | undefined {
    if (!context) {
      return undefined;
    }

    const reserved = new Set([
      "className",
      "class",
      "classRef",
      "service",
      "scope",
      "methodName",
      "method",
      "operation",
      "event",
      "source",
      "sourceName",
      "eventName",
      "name",
    ]);

    const nextEntries = Object.entries(context).filter(([key]) => !reserved.has(key));
    return nextEntries.length > 0 ? Object.fromEntries(nextEntries) : undefined;
  }

  private static compilePatterns(rawFilter: string | undefined): CompiledContextFilterPattern[] {
    if (!rawFilter || rawFilter.trim().length === 0) {
      return [];
    }

    return rawFilter
      .split(/[,;\s]+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0)
      .map((token) => ContextFilterLogger.compilePatternToken(token));
  }

  private static compilePatternToken(token: string): CompiledContextFilterPattern {
    const [kind, body] = ContextFilterLogger.parseKindAndBody(token);
    const expanded = ContextFilterLogger.expandPartialToGlob(body);

    return {
      raw: token,
      kind,
      matcher: ContextFilterLogger.globToRegex(expanded),
    };
  }

  private static parseKindAndBody(token: string): [ContextFilterPatternKind, string] {
    const colonIndex = token.indexOf(":");
    if (colonIndex <= 0) {
      return ["target", token];
    }

    const maybeKind = token.slice(0, colonIndex).trim().toLowerCase();
    const body = token.slice(colonIndex + 1).trim();

    if (maybeKind === "class" || maybeKind === "method" || maybeKind === "source" || maybeKind === "target") {
      return [maybeKind, body.length > 0 ? body : "*"];
    }

    return ["target", token];
  }

  private static expandPartialToGlob(input: string): string {
    const normalized = input.trim();
    if (normalized.length === 0) {
      return "*";
    }

    if (normalized.includes("*") || normalized.includes("?")) {
      return normalized;
    }

    return `*${normalized}*`;
  }

  private static globToRegex(globPattern: string): RegExp {
    // Array.from iterates over Unicode code points (handles surrogate pairs),
    // unlike the spread operator or `.split("")` which the linter flags.
    const escaped = Array.from(globPattern)
      .map((char) => {
        if (char === "*") {
          return ".*";
        }

        if (char === "?") {
          return ".";
        }

        return ContextFilterLogger.escapeRegexChar(char);
      })
      .join("");

    return new RegExp(`^${escaped}$`, "i");
  }

  private static escapeRegexChar(char: string): string {
    return /[\\^$.*+?()[\]{}|]/.test(char) ? `\\${char}` : char;
  }

  private static readBooleanEnv(envName: string | undefined): boolean {
    if (!envName) {
      return false;
    }

    const value = ContextFilterLogger.readEnvValue(envName);
    return value === "1" || value === "true" || value === "yes" || value === "on";
  }

  private static readEnvValue(envName: string): string | undefined {
    const runtimeProcess = (typeof globalThis !== "undefined" && "process" in globalThis)
      ? (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
      : undefined;

    return runtimeProcess?.env?.[envName];
  }

  private static resolveAppSourceTag(
    explicitAppSourceTag: string | undefined,
    appSourceEnvVar: string | undefined,
  ): string | undefined {
    const explicit = explicitAppSourceTag?.trim();
    if (explicit) {
      return explicit;
    }

    const envVarName = appSourceEnvVar ?? DEFAULT_APP_SOURCE_ENV_VAR;
    const envValue = ContextFilterLogger.readEnvValue(envVarName)?.trim();
    return envValue && envValue.length > 0 ? envValue : undefined;
  }
}
