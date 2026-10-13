import {
  projects2
} from "./migrations-r9ccee18.mjs";

// packages/nest/schema/src/global/image-project-membership.ts
import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
var imageProjectMembership2 = pgTable("image_project_membership", {
  id: uuid("id").primaryKey().defaultRandom(),
  imageIdentifierNormalized: text("image_identifier_normalized").notNull(),
  projectId: uuid("project_id").notNull().references(() => projects2.id, { onDelete: "cascade" }),
  serviceId: uuid("service_id"),
  createdAt: timestamp("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date).notNull()
}, (table) => [
  uniqueIndex("ipm_image_project_uidx").on(table.imageIdentifierNormalized, table.projectId)
]);

export { imageProjectMembership2 };
