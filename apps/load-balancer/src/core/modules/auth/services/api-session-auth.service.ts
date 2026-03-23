import { Injectable } from "@nestjs/common";
import type { Session } from "@repo/auth";
import { EnvService } from "../../../../config/env/env.service";

@Injectable()
export class ApiSessionAuthService {
    constructor(private readonly envService: EnvService) {}

    private get apiBaseUrl(): string {
        const candidate =
            this.envService.get("API_URL")?.trim() ??
            this.envService.get("APP_URL")?.trim() ??
            "http://localhost:3005";

        try {
            return new URL(candidate).origin;
        } catch {
            return "http://localhost:3005";
        }
    }

    async getSessionFromRequestHeaders(input: {
        cookie?: string;
        authorization?: string;
    }): Promise<Session | null> {
        const url = new URL("/api/auth/get-session", this.apiBaseUrl);

        const headers = new Headers();
        if (input.cookie) {
            headers.set("cookie", input.cookie);
        }
        if (input.authorization) {
            headers.set("authorization", input.authorization);
        }

        const response = await fetch(url, {
            method: "GET",
            headers,
        });

        if (response.status === 401 || response.status === 403) {
            return null;
        }

        if (!response.ok) {
            return null;
        }

        try {
            const payload = (await response.json());

            if (!payload || typeof payload !== "object") {
                return null;
            }

            if ("session" in payload || "user" in payload) {
                return payload as Session;
            }

            if (
                "data" in payload &&
                (payload as { data?: unknown }).data &&
                typeof (payload as { data?: unknown }).data === "object"
            ) {
                return (payload as { data: Session }).data;
            }

            return null;
        } catch {
            return null;
        }
    }
}