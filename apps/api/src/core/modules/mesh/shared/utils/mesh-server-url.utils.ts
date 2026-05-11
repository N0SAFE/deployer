import type { EnvService } from "@/config/env/env.service";

/**
 * Résout l'URL publique du serveur local.
 *
 * Priorité :
 *  1. `APP_URL` via EnvService (si fourni)
 *  2. `APP_URL` depuis process.env directement
 *  3. Fallback `http://localhost:3001`
 *
 * Utilisé par :
 *  - MeshClusterSyncService (enregistrement du nœud local)
 *  - MeshTopicResourceIndexService (indexation des topics)
 *  - MeshResourceQueryBuilder.autoRegister()
 */
export function resolveLocalServerUrl(envService?: EnvService): string {
    const candidate =
        envService?.get("APP_URL")?.toString().trim() ??
        process.env.APP_URL?.trim() ??
        "http://localhost:3001";

    try {
        return new URL(candidate).origin;
    } catch {
        return "http://localhost:3001";
    }
}

/**
 * Convertit une URL HTTP(S) en URL WebSocket mesh.
 *
 * Utilisé par :
 *  - MeshClusterSyncService.toMeshEndpointUrl()
 *
 * @example
 * toMeshWebSocketUrl("https://api.example.com/v1")
 * // → "wss://api.example.com/v1/mesh"
 */
export function toMeshWebSocketUrl(serverUrl: string): string {
    try {
        const parsed = new URL(serverUrl);
        const protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
        const pathname = parsed.pathname.endsWith("/")
            ? `${parsed.pathname}mesh`
            : `${parsed.pathname}/mesh`;
        return `${protocol}//${parsed.host}${pathname}`;
    } catch {
        return serverUrl;
    }
}