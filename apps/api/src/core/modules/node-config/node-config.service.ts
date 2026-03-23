import { Injectable, Logger } from "@nestjs/common";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { Client } from "pg";

export interface NodeConfig {
    databaseUrl: string;
    nodeId: string;
    configuredAt: string;
}

@Injectable()
export class NodeConfigService {
    private readonly logger = new Logger(NodeConfigService.name);
    private readonly configDir: string;
    private readonly configPath: string;
    private cachedConfig: NodeConfig | null | undefined = undefined; // undefined = not yet read

    constructor() {
        this.configDir = process.env.NODE_CONFIG_PATH ?? "/app/config";
        this.configPath = path.join(this.configDir, "node.json");
        this.logger.log(`Node config path: ${this.configPath}`);
    }

    /** Returns true when a valid config file with databaseUrl exists */
    isConfigured(): boolean {
        const config = this.readConfig();
        return config !== null && !!config.databaseUrl;
    }

    /** Returns null if not configured */
    getConfig(): NodeConfig | null {
        return this.readConfig();
    }

    /** Returns DATABASE_URL from env (override) OR config file, whichever is set first */
    getDatabaseUrl(): string | undefined {
        // Env var always wins — useful for CI, tests, and compose-file overrides
        if (process.env.DATABASE_URL) {
            return process.env.DATABASE_URL;
        }
        return this.readConfig()?.databaseUrl;
    }

    /** Save config to disk. Creates the directory if it doesn't exist. */
    saveConfig(config: NodeConfig): void {
        try {
            if (!fs.existsSync(this.configDir)) {
                fs.mkdirSync(this.configDir, { recursive: true });
            }
            fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), { encoding: "utf-8", mode: 0o600 });
            this.cachedConfig = config;
            this.logger.log(`Node config saved (nodeId=${config.nodeId})`);
        } catch (error) {
            this.logger.error("Failed to save node config", error);
            throw error;
        }
    }

    /**
     * Test a Postgres connection without saving anything.
     * Returns true if the connection succeeds, false otherwise.
     */
    async testConnection(databaseUrl: string): Promise<boolean> {
        const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
        try {
            await client.connect();
            await client.query("SELECT 1");
            return true;
        } catch {
            return false;
        } finally {
            await client.end().catch(() => undefined);
        }
    }

    /**
     * Test a Postgres connection and check if it's a fresh database
     * (no users in the `user` table yet).
     */
    async probeDatabase(databaseUrl: string): Promise<{ connected: boolean; isNewDatabase: boolean }> {
        const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
        try {
            await client.connect();
            // Check if the user table exists and has rows
            const result = await client.query<{ exists: boolean }>(
                `SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = 'user'
                ) AS exists`,
            );
            const tableExists = result.rows[0]?.exists ?? false;
            if (!tableExists) {
                return { connected: true, isNewDatabase: true };
            }
            const countResult = await client.query<{ count: string }>("SELECT COUNT(*) FROM \"user\" LIMIT 1");
            const userCount = parseInt(countResult.rows[0]?.count ?? "0", 10);
            return { connected: true, isNewDatabase: userCount === 0 };
        } catch {
            return { connected: false, isNewDatabase: false };
        } finally {
            await client.end().catch(() => undefined);
        }
    }

    /** Generate a new random node ID */
    generateNodeId(): string {
        return crypto.randomUUID();
    }

    private readConfig(): NodeConfig | null {
        if (this.cachedConfig !== undefined) {
            return this.cachedConfig;
        }
        try {
            if (!fs.existsSync(this.configPath)) {
                this.cachedConfig = null;
                return null;
            }
            const raw = fs.readFileSync(this.configPath, "utf-8");
            const parsed = JSON.parse(raw) as NodeConfig;
            if (!parsed.databaseUrl || !parsed.nodeId) {
                this.logger.warn("Node config file exists but is missing required fields");
                this.cachedConfig = null;
                return null;
            }
            this.cachedConfig = parsed;
            return parsed;
        } catch (error) {
            this.logger.error("Failed to read node config", error);
            this.cachedConfig = null;
            return null;
        }
    }
}
