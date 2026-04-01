"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { filter as rxjsFilter, map as rxjsMap } from "rxjs";
import { createObservableQueryUtils, type ObservablePipeTransform } from "@repo/orpc-utils";
import { orpc } from "@/lib/orpc/client";
import type { LogEvent } from "@/lib/orpc/contract";

const MAX_LINES = 120;
const DEFAULT_INPUT = {
  count: 40,
  intervalMs: 200,
} as const;

type PanelStatus = "idle" | "streaming" | "completed" | "error";

const streamLogsQueryUtils = createObservableQueryUtils(orpc).streamObservableLogs;

type ObservablePipeTabId = "identity" | "warnings-errors" | "annotated";

const OBSERVABLE_PIPE_TAB_CONFIG: Record<
  ObservablePipeTabId,
  {
    label: string;
    subtitle: string;
    pipe: ObservablePipeTransform<LogEvent>;
  }
> = {
  identity: {
    label: "Identity",
    subtitle: "pipe(map(x => x))",
    pipe: (p) => p(rxjsMap((value) => value)),
  },
  "warnings-errors": {
    label: "Warn + Error",
    subtitle: "pipe(filter(level !== 'info'))",
    pipe: (p) => p(rxjsFilter((value) => value.level !== "info")),
  },
  annotated: {
    label: "Annotated",
    subtitle: "pipe(map(message => '[PIPE] ...'))",
    pipe: (p) =>
      p(
        rxjsMap((value) => ({
          ...value,
          message: `[PIPE] ${value.message}`,
        })),
      ),
  },
};

const OBSERVABLE_PIPE_TAB_ORDER: ObservablePipeTabId[] = [
  "identity",
  "warnings-errors",
  "annotated",
];

type EventIteratorModeTabId = "async-iterator" | "raw-iterator";

const EVENT_ITERATOR_MODE_CONFIG: Record<
  EventIteratorModeTabId,
  {
    label: string;
    subtitle: string;
  }
> = {
  "async-iterator": {
    label: "Async Iterator",
    subtitle: "for await (const event of iterator)",
  },
  "raw-iterator": {
    label: "Raw Iterator",
    subtitle: "iterator.next() loop",
  },
};

const EVENT_ITERATOR_TAB_ORDER: EventIteratorModeTabId[] = ["async-iterator", "raw-iterator"];

function isLogEvent(value: unknown): value is LogEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<LogEvent>;
  return (
    typeof candidate.index === "number" &&
    (candidate.level === "info" || candidate.level === "warn" || candidate.level === "error") &&
    typeof candidate.message === "string" &&
    typeof candidate.emittedAt === "string"
  );
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

function appendWithLimit(previous: LogEvent[], nextEvent: LogEvent): LogEvent[] {
  const next = [...previous, nextEvent];
  return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown stream error";
}

function resolvePanelStatusFromLifecycle(isCompleted: boolean, errorMessage: string | null): PanelStatus {
  if (errorMessage) {
    return "error";
  }

  if (isCompleted) {
    return "completed";
  }

  return "streaming";
}

function StreamPanelCard({
  title,
  subtitle,
  logs,
  status,
  errorMessage,
  onRestart,
}: {
  title: string;
  subtitle: string;
  logs: LogEvent[];
  status: PanelStatus;
  errorMessage: string | null;
  onRestart: () => void;
}) {
  const statusLabel = useMemo(() => {
    switch (status) {
      case "streaming":
        return "Streaming live logs…";
      case "completed":
        return "Stream completed ✅";
      case "error":
        return "Stream failed ❌";
      default:
        return "Idle";
    }
  }, [status]);

  return (
    <section
      style={{
        border: "1px solid #1e293b",
        borderRadius: 12,
        overflow: "hidden",
        background: "#020617",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          padding: "12px 16px",
          borderBottom: "1px solid #1e293b",
          background: "#0f172a",
        }}
      >
        <div>
          <strong style={{ display: "block" }}>{title}</strong>
          <span style={{ color: "#94a3b8", fontSize: 12 }}>{subtitle}</span>
          <div style={{ color: "#bfdbfe", fontSize: 12, marginTop: 2 }}>{statusLabel}</div>
        </div>

        <button
          onClick={onRestart}
          style={{
            background: "#2563eb",
            color: "white",
            border: "none",
            borderRadius: 8,
            padding: "8px 12px",
            cursor: "pointer",
          }}
        >
          Restart
        </button>
      </header>

      {errorMessage ? <div style={{ color: "#fecaca", padding: 16 }}>{errorMessage}</div> : null}

      <pre
        style={{
          margin: 0,
          padding: 16,
          minHeight: 320,
          maxHeight: 420,
          overflow: "auto",
          fontSize: 13,
          lineHeight: 1.5,
          color: "#bfdbfe",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {logs.length === 0
          ? "Waiting for first server event…"
          : logs
              .map((event) => `[${event.level.toUpperCase()}] ${event.emittedAt} :: ${event.message}`)
              .join("\n")}
      </pre>
    </section>
  );
}

export function RawAwaitedObservablePanel() {
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [isCompleted, setIsCompleted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [runToken, setRunToken] = useState(0);

  useEffect(() => {
    const abortController = new AbortController();
    let subscription: { unsubscribe(): void } | null = null;

    void (async () => {
      try {
        const stream$ = await orpc.streamObservableLogs({ ...DEFAULT_INPUT });

        if (abortController.signal.aborted) {
          return;
        }

        subscription = stream$.subscribe({
          next(event: unknown) {
            if (!isLogEvent(event)) {
              return;
            }

            setLogs((previous) => appendWithLimit(previous, event));
          },
          error(error: unknown) {
            if (abortController.signal.aborted) {
              return;
            }

            setErrorMessage(toErrorMessage(error));
          },
          complete() {
            if (abortController.signal.aborted) {
              return;
            }

            setIsCompleted(true);
          },
        });
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setErrorMessage(toErrorMessage(error));
      }
    })();

    return () => {
      abortController.abort();
      subscription?.unsubscribe();
    };
  }, [runToken]);

  const status = resolvePanelStatusFromLifecycle(isCompleted, errorMessage);

  return (
    <StreamPanelCard
      title="Raw awaited observable"
      subtitle="await orpc.streamObservableLogs(input)"
      logs={logs}
      status={status}
      errorMessage={errorMessage}
      onRestart={() => {
        setLogs([]);
        setIsCompleted(false);
        setErrorMessage(null);
        setRunToken((value) => value + 1);
      }}
    />
  );
}

export function ObservableOptionsQueryPanel() {
  const [runToken, setRunToken] = useState(0);

  const observableQuery = useQuery(
    streamLogsQueryUtils.experimental_observableOptions({
      input: { ...DEFAULT_INPUT },
      queryKey: ["streamLogs", "observable", runToken],
    }),
  );

  const hasData = observableQuery.data !== undefined;
  const isFetching = observableQuery.fetchStatus === "fetching";
  const isPaused = observableQuery.fetchStatus === "paused";
  const logs = observableQuery.data ? [observableQuery.data] : [];
  const status: PanelStatus = isFetching
    ? "streaming"
    : observableQuery.status === "error"
      ? "error"
      : observableQuery.status === "success"
        ? "completed"
        : "idle";
  const errorMessage = observableQuery.isError ? toErrorMessage(observableQuery.error) : null;
  const subtitle = isFetching && hasData
    ? "direct chunk data + query.fetchStatus · showing cached data while refreshing"
    : observableQuery.status === "pending" && !hasData
      ? "direct chunk data + query.fetchStatus · waiting for first payload"
      : isPaused
        ? "direct chunk data + query.fetchStatus · stream paused"
        : "direct chunk data + query.fetchStatus";

  return (
    <StreamPanelCard
      title="useQuery + experimental_observableOptions"
      subtitle={subtitle}
      logs={logs}
      status={status}
      errorMessage={errorMessage}
      onRestart={() => {
        setRunToken((value) => value + 1);
      }}
    />
  );
}

export function StreamedObservableOptionsQueryPanel() {
  const [runToken, setRunToken] = useState(0);

  const streamedQuery = useQuery(
    streamLogsQueryUtils.experimental_streamedObservableOptions({
      input: { ...DEFAULT_INPUT },
      queryKey: ["streamLogs", "streamed-observable", runToken],
      queryFnOptions: {
        pipe: (rxjsPipe) => rxjsPipe(rxjsMap((value) => value)),
      },
    }),
  );

  const hasData = streamedQuery.data !== undefined;
  const isFetching = streamedQuery.fetchStatus === "fetching";
  const isPaused = streamedQuery.fetchStatus === "paused";
  const logs = streamedQuery.data ?? [];
  const status: PanelStatus = isFetching
    ? "streaming"
    : streamedQuery.status === "error"
      ? "error"
      : streamedQuery.status === "success"
        ? "completed"
        : "idle";
  const errorMessage = streamedQuery.isError ? toErrorMessage(streamedQuery.error) : null;
  const subtitle = isFetching && hasData
    ? "stream collection + queryFnOptions.pipe · showing cached data while refreshing"
    : streamedQuery.status === "pending" && !hasData
      ? "stream collection + queryFnOptions.pipe · waiting for first payload"
      : isPaused
        ? "stream collection + queryFnOptions.pipe · stream paused"
        : "stream collection + queryFnOptions.pipe";

  return (
    <StreamPanelCard
      title="useQuery + experimental_streamedObservableOptions"
      subtitle={subtitle}
      logs={logs}
      status={status}
      errorMessage={errorMessage}
      onRestart={() => {
        setRunToken((value) => value + 1);
      }}
    />
  );
}

export function ObservableOptionsPipeTabsPanel() {
  const [activeTab, setActiveTab] = useState<ObservablePipeTabId>("identity");
  const [runToken, setRunToken] = useState(0);

  const tabConfig = OBSERVABLE_PIPE_TAB_CONFIG[activeTab];

  const observableQuery = useQuery(
    streamLogsQueryUtils.experimental_streamedObservableOptions({
      input: { ...DEFAULT_INPUT },
      queryKey: ["streamLogs", "observable-pipe-tabs", activeTab, runToken],
      queryFnOptions: {
        pipe: tabConfig.pipe,
      },
    }),
  );

  const hasData = observableQuery.data !== undefined;
  const isFetching = observableQuery.fetchStatus === "fetching";
  const isPaused = observableQuery.fetchStatus === "paused";
  const logs = observableQuery.data ?? [];
  const status: PanelStatus = isFetching
    ? "streaming"
    : observableQuery.status === "error"
      ? "error"
      : observableQuery.status === "success"
        ? "completed"
        : "idle";

  const errorMessage = observableQuery.isError ? toErrorMessage(observableQuery.error) : null;
  const subtitle = isFetching && hasData
    ? `${tabConfig.subtitle} · showing cached data while refreshing`
    : observableQuery.status === "pending" && !hasData
      ? `${tabConfig.subtitle} · waiting for first payload`
      : isPaused
        ? `${tabConfig.subtitle} · stream paused`
        : tabConfig.subtitle;

  return (
    <section
      style={{
        border: "1px solid #1e293b",
        borderRadius: 12,
        overflow: "hidden",
        background: "#020617",
      }}
    >
      <header
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid #1e293b",
          background: "#0f172a",
        }}
      >
        <strong style={{ display: "block" }}>3 tabs · useQuery + experimental_streamedObservableOptions + pipe</strong>
        <span style={{ color: "#94a3b8", fontSize: 12 }}>
          Each tab applies a different RxJS pipe transform to the same stream.
        </span>

        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          {OBSERVABLE_PIPE_TAB_ORDER.map((tabId) => {
            const config = OBSERVABLE_PIPE_TAB_CONFIG[tabId];
            const isActive = tabId === activeTab;

            return (
              <button
                key={tabId}
                onClick={() => {
                  setActiveTab(tabId);
                  setRunToken((value) => value + 1);
                }}
                style={{
                  background: isActive ? "#2563eb" : "#1e293b",
                  color: "white",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 12px",
                  cursor: "pointer",
                }}
              >
                {config.label}
              </button>
            );
          })}

          <button
            onClick={() => {
              setRunToken((value) => value + 1);
            }}
            style={{
              marginLeft: "auto",
              background: "#2563eb",
              color: "white",
              border: "none",
              borderRadius: 8,
              padding: "8px 12px",
              cursor: "pointer",
            }}
          >
            Restart
          </button>
        </div>
      </header>

      <StreamPanelCard
        title={`Tab: ${tabConfig.label}`}
        subtitle={subtitle}
        logs={logs}
        status={status}
        errorMessage={errorMessage}
        onRestart={() => {
          setRunToken((value) => value + 1);
        }}
      />
    </section>
  );
}

export function EventIteratorTerminalTabsPanel() {
  const [activeTab, setActiveTab] = useState<EventIteratorModeTabId>("async-iterator");
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [isCompleted, setIsCompleted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [runToken, setRunToken] = useState(0);

  const tabConfig = EVENT_ITERATOR_MODE_CONFIG[activeTab];

  useEffect(() => {
    let manualIterator: AsyncIterator<LogEvent, unknown, unknown> | null = null;

    void (async () => {
      try {
        const iteratorSourceResult: unknown = await orpc.streamLogs(
          { ...DEFAULT_INPUT },
        );

        if (!isAsyncIterable(iteratorSourceResult)) {
          throw new Error("Expected async iterator output from orpc.streamLogs");
        }

        const iteratorSource = iteratorSourceResult;

        if (activeTab === "async-iterator") {
          for await (const event of iteratorSource) {
            if (!isLogEvent(event)) {
              continue;
            }

            setLogs((previous) => appendWithLimit(previous, event));
          }
        } else {
          manualIterator = iteratorSource[Symbol.asyncIterator]() as AsyncIterator<
            LogEvent,
            unknown,
            unknown
          >;

          for (;;) {
            const result = await manualIterator.next();
            if (result.done) {
              break;
            }

            if (!isLogEvent(result.value)) {
              continue;
            }

            setLogs((previous) => appendWithLimit(previous, result.value));
          }
        }

        setIsCompleted(true);
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
      }
    })();

    return () => {
      void manualIterator?.return?.();
    };
  }, [activeTab, runToken]);

  const status = resolvePanelStatusFromLifecycle(isCompleted, errorMessage);

  return (
    <section
      style={{
        border: "1px solid #1e293b",
        borderRadius: 12,
        overflow: "hidden",
        background: "#020617",
      }}
    >
      <header
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid #1e293b",
          background: "#0f172a",
        }}
      >
        <strong style={{ display: "block" }}>Event Iterator terminal (same payload, different consumer)</strong>
        <span style={{ color: "#94a3b8", fontSize: 12 }}>
          Compare async iterator syntax and raw iterator API side by side against the same backend stream.
        </span>

        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          {EVENT_ITERATOR_TAB_ORDER.map((tabId) => {
            const config = EVENT_ITERATOR_MODE_CONFIG[tabId];
            const isActive = tabId === activeTab;

            return (
              <button
                key={tabId}
                onClick={() => {
                  setActiveTab(tabId);
                  setLogs([]);
                  setIsCompleted(false);
                  setErrorMessage(null);
                  setRunToken((value) => value + 1);
                }}
                style={{
                  background: isActive ? "#2563eb" : "#1e293b",
                  color: "white",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 12px",
                  cursor: "pointer",
                }}
              >
                {config.label}
              </button>
            );
          })}

          <button
            onClick={() => {
              setLogs([]);
              setIsCompleted(false);
              setErrorMessage(null);
              setRunToken((value) => value + 1);
            }}
            style={{
              marginLeft: "auto",
              background: "#2563eb",
              color: "white",
              border: "none",
              borderRadius: 8,
              padding: "8px 12px",
              cursor: "pointer",
            }}
          >
            Restart
          </button>
        </div>
      </header>

      <StreamPanelCard
        title={`Tab: ${tabConfig.label}`}
        subtitle={tabConfig.subtitle}
        logs={logs}
        status={status}
        errorMessage={errorMessage}
        onRestart={() => {
          setLogs([]);
          setIsCompleted(false);
          setErrorMessage(null);
          setRunToken((value) => value + 1);
        }}
      />
    </section>
  );
}
