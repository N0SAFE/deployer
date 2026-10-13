// packages/nest/schema/src/global/auth.ts
import { relations } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  index,
  uniqueIndex
} from "drizzle-orm/pg-core";
var user2 = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").$onUpdate(() => new Date).notNull(),
  role: text("role").default("user").notNull(),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
  twoFactorEnabled: boolean("two_factor_enabled").default(false)
});
var session2 = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").$onUpdate(() => new Date).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user2.id, { onDelete: "cascade" }),
  impersonatedBy: text("impersonated_by")
}, (table) => [index("session_userId_idx").on(table.userId)]);
var account2 = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user2.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").$onUpdate(() => new Date).notNull()
}, (table) => [index("account_userId_idx").on(table.userId)]);
var verification2 = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").$onUpdate(() => new Date).notNull()
}, (table) => [index("verification_identifier_idx").on(table.identifier)]);
var platformInvite2 = pgTable("platform_invite", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  email: text("email").notNull(),
  role: text("role").notNull(),
  createdAt: timestamp("created_at").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  invitedUserId: text("invited_user_id").notNull().references(() => user2.id, { onDelete: "cascade" })
});
var userVapidKeys2 = pgTable("user_vapid_keys", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().unique().references(() => user2.id, { onDelete: "cascade" }),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  subject: text("subject"),
  createdAt: timestamp("created_at").notNull()
});
var pushSubscription2 = pgTable("push_subscription", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user2.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  deviceName: text("device_name"),
  userAgent: text("user_agent"),
  isActive: boolean("is_active").notNull(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  lastUsedAt: timestamp("last_used_at")
});
var apikey2 = pgTable("apikey", {
  id: text("id").primaryKey(),
  configId: text("config_id").default("default").notNull(),
  name: text("name"),
  start: text("start"),
  referenceId: text("reference_id").notNull(),
  prefix: text("prefix"),
  key: text("key").notNull(),
  refillInterval: integer("refill_interval"),
  refillAmount: integer("refill_amount"),
  lastRefillAt: timestamp("last_refill_at"),
  enabled: boolean("enabled").default(true),
  rateLimitEnabled: boolean("rate_limit_enabled").default(true),
  rateLimitTimeWindow: integer("rate_limit_time_window").default(3600000),
  rateLimitMax: integer("rate_limit_max").default(1000),
  requestCount: integer("request_count").default(0),
  remaining: integer("remaining"),
  lastRequest: timestamp("last_request"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  permissions: text("permissions"),
  metadata: text("metadata")
}, (table) => [
  index("apikey_configId_idx").on(table.configId),
  index("apikey_referenceId_idx").on(table.referenceId),
  index("apikey_key_idx").on(table.key)
]);
var passkey2 = pgTable("passkey", {
  id: text("id").primaryKey(),
  name: text("name"),
  publicKey: text("public_key").notNull(),
  userId: text("user_id").notNull().references(() => user2.id, { onDelete: "cascade" }),
  credentialID: text("credential_id").notNull(),
  counter: integer("counter").notNull(),
  deviceType: text("device_type").notNull(),
  backedUp: boolean("backed_up").notNull(),
  transports: text("transports"),
  createdAt: timestamp("created_at"),
  aaguid: text("aaguid")
}, (table) => [
  index("passkey_userId_idx").on(table.userId),
  index("passkey_credentialID_idx").on(table.credentialID)
]);
var twoFactor2 = pgTable("two_factor", {
  id: text("id").primaryKey(),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  userId: text("user_id").notNull().references(() => user2.id, { onDelete: "cascade" }),
  verified: boolean("verified").default(true),
  failedVerificationCount: integer("failed_verification_count").default(0),
  lockedUntil: timestamp("locked_until")
}, (table) => [
  index("twoFactor_secret_idx").on(table.secret),
  index("twoFactor_userId_idx").on(table.userId)
]);
var deviceCode2 = pgTable("device_code", {
  id: text("id").primaryKey(),
  deviceCode: text("device_code").notNull(),
  userCode: text("user_code").notNull(),
  userId: text("user_id"),
  expiresAt: timestamp("expires_at").notNull(),
  status: text("status").notNull(),
  lastPolledAt: timestamp("last_polled_at"),
  pollingInterval: integer("polling_interval"),
  clientId: text("client_id"),
  scope: text("scope")
}, (table) => [
  uniqueIndex("deviceCode_deviceCode_uidx").on(table.deviceCode),
  uniqueIndex("deviceCode_userCode_uidx").on(table.userCode)
]);
var userRelations2 = relations(user2, ({ one, many }) => ({
  sessions: many(session2),
  accounts: many(account2),
  platformInvites: many(platformInvite2),
  userVapidKeys: one(userVapidKeys2),
  pushSubscriptions: many(pushSubscription2),
  passkeys: many(passkey2),
  twoFactors: many(twoFactor2)
}));
var sessionRelations2 = relations(session2, ({ one }) => ({
  user: one(user2, {
    fields: [session2.userId],
    references: [user2.id]
  })
}));
var accountRelations2 = relations(account2, ({ one }) => ({
  user: one(user2, {
    fields: [account2.userId],
    references: [user2.id]
  })
}));
var platformInviteRelations2 = relations(platformInvite2, ({ one }) => ({
  user: one(user2, {
    fields: [platformInvite2.invitedUserId],
    references: [user2.id]
  })
}));
var userVapidKeysRelations2 = relations(userVapidKeys2, ({ one }) => ({
  user: one(user2, {
    fields: [userVapidKeys2.userId],
    references: [user2.id]
  })
}));
var pushSubscriptionRelations2 = relations(pushSubscription2, ({ one }) => ({
  user: one(user2, {
    fields: [pushSubscription2.userId],
    references: [user2.id]
  })
}));

export { user2, session2, account2, verification2, platformInvite2, userVapidKeys2, pushSubscription2, apikey2, passkey2, twoFactor2, deviceCode2, userRelations2, sessionRelations2, accountRelations2, platformInviteRelations2, userVapidKeysRelations2, pushSubscriptionRelations2 };
