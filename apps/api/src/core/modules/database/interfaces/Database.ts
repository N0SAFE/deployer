import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/config/drizzle/schema";

// Define the proper database type with schema
export type Database = NodePgDatabase<typeof schema>;
