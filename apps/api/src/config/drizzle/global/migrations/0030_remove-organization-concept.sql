ALTER TABLE "org_role_rules" RENAME TO "role_rules";
--> statement-breakpoint
ALTER INDEX "org_role_rules_roleName_uidx" RENAME TO "role_rules_roleName_uidx";
