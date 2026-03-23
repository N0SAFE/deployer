import type { Metadata } from "next";
import type { ReactNode } from "react";
import { QueryProvider } from "./query-provider";

export const metadata: Metadata = {
  title: "Observable Stream POC",
  description: "ORPC observable-first streaming demo",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "#0b1020",
          color: "#dbeafe",
        }}
      >
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
