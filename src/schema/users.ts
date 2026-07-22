import { pgTable, text, boolean, real, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  deviceId: text("device_id").unique(),
  email: text("email").unique(),
  phone: text("phone").unique(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  name: text("name").notNull().default(""),
  role: text("role", { enum: ["sender", "courier"] }).notNull().default("sender"),
  isOnline: boolean("is_online").notNull().default(false),
  currentLat: real("current_lat"),
  currentLng: real("current_lng"),
  rating: real("rating"),
  totalDeliveries: integer("total_deliveries").notNull().default(0),
  stripeCustomerId: text("stripe_customer_id"),
  googleId: text("google_id").unique(),
  appleId: text("apple_id").unique(),
  pushToken: text("push_token"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const sessionsTable = pgTable("sessions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => usersTable.id),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const otpCodesTable = pgTable("otp_codes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  target: text("target").notNull(),
  type: text("type", { enum: ["phone", "email"] }).notNull(),
  code: text("code").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
export type Session = typeof sessionsTable.$inferSelect;
export type OtpCode = typeof otpCodesTable.$inferSelect;
