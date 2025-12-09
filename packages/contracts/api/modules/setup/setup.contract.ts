import { oc } from "@orpc/contract";
import { z } from "zod";

/**
 * Setup Contract - Initial application setup and configuration
 * 
 * Provides endpoints for first-time setup when no users exist in the system.
 * Creates the initial admin user and default organization.
 */

// Output schemas for type extraction
export const checkSetupStatusOutput = z.object({
  needsSetup: z.boolean().describe("True if initial setup is required"),
  hasUsers: z.boolean().describe("True if users exist in the database"),
});

export const createInitialUserOutput = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    role: z.string(),
  }),
  organization: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
  }),
  session: z.object({
    token: z.string(),
    expiresAt: z.string(),
  }),
});

export const setupContract = oc.router({
  /**
   * Check if initial setup is required
   * Returns true if no users exist in the database
   */
  checkSetupStatus: oc.route({
    method: "GET",
    path: "/setup/status",
    summary: "Check if initial setup is required",
    description: "Returns whether the application needs initial setup (no users exist)",
  }).input(z.object({})).output(checkSetupStatusOutput),

  /**
   * Create initial user and organization
   * Only works when no users exist in the database
   */
  createInitialUser: oc.route({
    method: "POST",
    path: "/setup/initialize",
    summary: "Create initial admin user and organization",
    description: "Creates the first user with admin privileges and their default organization",
  }).input(
    z.object({
      name: z.string().min(1, "Name is required"),
      email: z.string().email("Invalid email address"),
      password: z.string().min(8, "Password must be at least 8 characters"),
      organizationName: z.string().min(1, "Organization name is required").default("Default Organization"),
    })
  ).output(createInitialUserOutput),
});

export type SetupContract = typeof setupContract;
