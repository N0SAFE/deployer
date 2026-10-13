// packages/nest/schema/src/global/events.ts
import { pgTable as pgTable2, text as text2, timestamp as timestamp2, boolean as boolean2, integer as integer2, uuid, jsonb, index as index2 } from "drizzle-orm/pg-core";
import { relations as relations2 } from "drizzle-orm";

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
var user = pgTable("user", {
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
var session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").$onUpdate(() => new Date).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  impersonatedBy: text("impersonated_by")
}, (table) => [index("session_userId_idx").on(table.userId)]);
var account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
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
var verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").$onUpdate(() => new Date).notNull()
}, (table) => [index("verification_identifier_idx").on(table.identifier)]);
var platformInvite = pgTable("platform_invite", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  email: text("email").notNull(),
  role: text("role").notNull(),
  createdAt: timestamp("created_at").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  invitedUserId: text("invited_user_id").notNull().references(() => user.id, { onDelete: "cascade" })
});
var userVapidKeys = pgTable("user_vapid_keys", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().unique().references(() => user.id, { onDelete: "cascade" }),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  subject: text("subject"),
  createdAt: timestamp("created_at").notNull()
});
var pushSubscription = pgTable("push_subscription", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
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
var apikey = pgTable("apikey", {
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
var passkey = pgTable("passkey", {
  id: text("id").primaryKey(),
  name: text("name"),
  publicKey: text("public_key").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
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
var twoFactor = pgTable("two_factor", {
  id: text("id").primaryKey(),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  verified: boolean("verified").default(true),
  failedVerificationCount: integer("failed_verification_count").default(0),
  lockedUntil: timestamp("locked_until")
}, (table) => [
  index("twoFactor_secret_idx").on(table.secret),
  index("twoFactor_userId_idx").on(table.userId)
]);
var deviceCode = pgTable("device_code", {
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
var userRelations = relations(user, ({ one, many }) => ({
  sessions: many(session),
  accounts: many(account),
  platformInvites: many(platformInvite),
  userVapidKeys: one(userVapidKeys),
  pushSubscriptions: many(pushSubscription),
  passkeys: many(passkey),
  twoFactors: many(twoFactor)
}));
var sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id]
  })
}));
var accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id]
  })
}));
var platformInviteRelations = relations(platformInvite, ({ one }) => ({
  user: one(user, {
    fields: [platformInvite.invitedUserId],
    references: [user.id]
  })
}));
var userVapidKeysRelations = relations(userVapidKeys, ({ one }) => ({
  user: one(user, {
    fields: [userVapidKeys.userId],
    references: [user.id]
  })
}));
var pushSubscriptionRelations = relations(pushSubscription, ({ one }) => ({
  user: one(user, {
    fields: [pushSubscription.userId],
    references: [user.id]
  })
}));

// packages/nest/schema/src/global/events.ts
var coreEventStreams = pgTable2("core_event_streams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text2("name").notNull(),
  namespace: text2("namespace").notNull(),
  description: text2("description"),
  isActive: boolean2("is_active").default(true).notNull(),
  scope: text2("scope").notNull().default("global"),
  scopeId: text2("scope_id"),
  filters: jsonb("filters").$type(),
  replayDefault: boolean2("replay_default").default(true).notNull(),
  replayLimitDefault: integer2("replay_limit_default").default(100).notNull(),
  createdBy: text2("created_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp2("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp2("updated_at").$defaultFn(() => new Date).notNull()
});
var coreEventStreamsRelations = relations2(coreEventStreams, ({ one }) => ({
  createdByUser: one(user, {
    fields: [coreEventStreams.createdBy],
    references: [user.id]
  })
}));
var coreEventLogs = pgTable2("core_event_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  namespace: text2("namespace").notNull(),
  eventName: text2("event_name").notNull(),
  eventKey: text2("event_key").notNull(),
  sequence: integer2("sequence").notNull(),
  input: jsonb("input").$type().notNull(),
  output: jsonb("output").$type().notNull(),
  emittedAt: timestamp2("emitted_at").$defaultFn(() => new Date).notNull(),
  createdAt: timestamp2("created_at").defaultNow().$defaultFn(() => new Date).notNull()
}, (table) => [
  index2("core_event_logs_namespace_idx").on(table.namespace),
  index2("core_event_logs_event_name_idx").on(table.eventName),
  index2("core_event_logs_event_key_idx").on(table.eventKey),
  index2("core_event_logs_emitted_at_idx").on(table.emittedAt)
]);
export {
  coreEventLogs,
  coreEventStreams,
  coreEventStreamsRelations
};
