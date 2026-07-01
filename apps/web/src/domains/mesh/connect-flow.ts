import { isRecord, isObjectLike } from "@repo/type-guards"
"use client";

export interface MeshRemoteSessionPayload {
  serverUrl: string;
  sessionId?: string;
  userId?: string;
  userEmail?: string;
  expiresAt?: string;
  retrievedAt: string;
  raw: Record<string, unknown> | null;
}

export function normalizeServerHttpUrl(value: string): string {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Server URL must start with http:// or https://");
  }

  parsed.pathname = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

export async function detectRemoteServer(serverUrl: string): Promise<void> {
  const pingResponse = await fetch(`${serverUrl}/api/server/ping`, {
    method: "GET",
    credentials: "include",
    headers: {
      Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
    },
  });

  if (!pingResponse.ok) {
    throw new Error(`Server ping failed (${pingResponse.status})`);
  }

  const payload = (await pingResponse.json()) as unknown;
  const pong = typeof payload === "string" ? payload : JSON.stringify(payload);
  if (!pong.toLowerCase().includes("pong")) {
    throw new Error("Server ping did not return pong");
  }
}

export function buildRemoteSignInUrl(serverUrl: string, callbackUrl: string): string {
  const parsed = new URL(serverUrl);
  parsed.pathname = "/auth/signin";
  parsed.search = "";
  parsed.hash = "";
  parsed.searchParams.set("callbackUrl", callbackUrl);
  return parsed.toString();
}

export function buildMeshEndpointUrl(serverUrl: string): string {
  const parsed = new URL(serverUrl);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = "/mesh";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}


/**
 * Type guard that narrows `unknown` to a record-like object so we can
 * index it with string keys.
 */
function parseSessionData(raw: unknown): {
  sessionId?: string;
  userId?: string;
  userEmail?: string;
  expiresAt?: string;
} {
  if (!raw || typeof raw !== "object") {
    return {};
  }

  const source = isRecord(raw) ? raw : {};
  const sessionCandidate =
    source.session && typeof source.session === "object"
      ? isRecord(source.session) ? source.session : {}
      : source;

  const userCandidate =
    source.user && typeof source.user === "object"
      ? isRecord(source.user) ? source.user : {}
      : undefined;

  const sessionId =
    typeof sessionCandidate.id === "string"
      ? sessionCandidate.id
      : typeof sessionCandidate.sessionId === "string"
        ? sessionCandidate.sessionId
        : undefined;

  const userId =
    typeof sessionCandidate.userId === "string"
      ? sessionCandidate.userId
      : typeof userCandidate?.id === "string"
        ? userCandidate.id
        : undefined;

  const userEmail =
    typeof userCandidate?.email === "string"
      ? userCandidate.email
      : typeof sessionCandidate.email === "string"
        ? sessionCandidate.email
        : undefined;

  const expiresAt =
    typeof sessionCandidate.expiresAt === "string" ? sessionCandidate.expiresAt : undefined;

  return { sessionId, userId, userEmail, expiresAt };
}

export async function fetchRemoteAuthSession(serverUrl: string): Promise<MeshRemoteSessionPayload> {
  const response = await fetch(`${serverUrl}/api/auth/get-session`, {
    method: "GET",
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Remote session fetch failed (${response.status})`);
  }

  const payload = (await response.json()) as unknown;
  const parsed = parseSessionData(payload);

  return {
    serverUrl,
    ...parsed,
    retrievedAt: new Date().toISOString(),
    raw: payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null,
  };
}
