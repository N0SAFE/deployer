import { pgTable, text, timestamp, boolean, uuid, index } from "drizzle-orm/pg-core";
import { encryptedText } from "@/config/drizzle/shared/custom-types/encrypted-text";

/**
 * GitLab source provider accounts.
 *
 * Mirrors `github_apps` but for the simpler GitLab model: a GitLab account is
 * an instance URL + a personal/project access token (no OAuth app manifest).
 * One row per configured GitLab account.
 */
export const gitlabApps = pgTable(
  "gitlab_apps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** GitLab instance base URL, e.g. https://gitlab.com or a self-hosted host. */
    url: text("url").notNull(),
    /** Personal / project access token (encrypted at rest). */
    accessToken: encryptedText("access_token").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => [
  ],
);
