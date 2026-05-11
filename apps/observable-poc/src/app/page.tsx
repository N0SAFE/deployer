import {
  EventIteratorTerminalTabsPanel,
  LiveObservableOptionsQueryPanel,
  ObservableOptionsPipeTabsPanel,
  RawAwaitedObservablePanel,
  StreamedObservableOptionsQueryPanel,
} from "./log-stream-panel";

export default function HomePage() {
  return (
    <main style={{ maxWidth: 1440, margin: "48px auto", padding: "0 20px" }}>
      <h1 style={{ marginTop: 0 }}>Observable-first ORPC Streaming POC</h1>
      <p style={{ color: "#93c5fd", marginBottom: 20 }}>
        This page compares three observable usages side by side: raw awaited client observable,
        <code> experimental_liveObservableOptions </code> in <code>useQuery</code>, and
        <code> experimental_streamedObservableOptions </code> in <code>useQuery</code>.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 16,
          alignItems: "start",
        }}
      >
        <RawAwaitedObservablePanel />
        <LiveObservableOptionsQueryPanel />
        <StreamedObservableOptionsQueryPanel />
      </div>

      <div style={{ marginTop: 20 }}>
        <ObservableOptionsPipeTabsPanel />
      </div>

      <div style={{ marginTop: 20 }}>
        <EventIteratorTerminalTabsPanel />
      </div>
    </main>
  );
}
