import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { projects } from "./deployment";

/**
 * Image → Project membership table.
 *
 * Tracks which images (by their normalized Docker reference) belong to
 * which projects. This enables project-scoped image listing and ensures
 * that images pushed for deployments are attributed to the right project.
 *
 * An image can belong to multiple projects (e.g., a shared base image).
 * Each row is uniquely identified by (imageIdentifierNormalized, projectId).
 *
 * The `imageIdentifierNormalized` field is the registry+repository+tag
 * stripped of auth and normalized (e.g. "docker.io/library/nginx:latest").
 * This matches the same field used in docker_image_security_scans for
 * join compatibility.
 */
export const imageProjectMembership = pgTable(
    "image_project_membership",
    {
        id: uuid("id").primaryKey().defaultRandom(),

        /** Normalized image identifier for consistent matching. */
        imageIdentifierNormalized: text("image_identifier_normalized").notNull(),

        /** The project this image belongs to. */
        projectId: uuid("project_id")
            .notNull()
            .references(() => projects.id, { onDelete: "cascade" }),

        /**
         * Optional service ID for more granular attribution.
         * When set, this image is specifically associated with a service
         * within the project. Null for shared/project-level images.
         */
        serviceId: uuid("service_id"),

        /** When this membership was recorded. */
        createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
        updatedAt: timestamp("updated_at").$defaultFn(() => new Date()).notNull(),
    },
    (table) => [
        uniqueIndex("ipm_image_project_uidx").on(table.imageIdentifierNormalized, table.projectId),
    ],
);
