import { pgTable, text, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { porterBoxesTable } from "./porterBoxes";

export const deliveriesTable = pgTable("deliveries", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  senderId: text("sender_id").notNull().references(() => usersTable.id),
  courierId: text("courier_id").references(() => usersTable.id),
  status: text("status", {
    enum: ["pending", "accepted", "picked_up", "in_box", "delivered", "cancelled"],
  }).notNull().default("pending"),
  deliveryType: text("delivery_type", {
    enum: ["standard", "porter_box", "box_dropoff"],
  }).notNull().default("standard"),
  porterBoxId: text("porter_box_id").references(() => porterBoxesTable.id),
  pickupCode: text("pickup_code"),
  packageSize: text("package_size", {
    enum: ["small", "medium", "large", "extra_large"],
  }).notNull(),
  packageDescription: text("package_description").notNull(),
  pickupAddress: text("pickup_address").notNull(),
  pickupLat: real("pickup_lat").notNull(),
  pickupLng: real("pickup_lng").notNull(),
  dropoffAddress: text("dropoff_address").notNull(),
  dropoffLat: real("dropoff_lat").notNull(),
  dropoffLng: real("dropoff_lng").notNull(),
  estimatedPrice: real("estimated_price").notNull(),
  distanceKm: real("distance_km"),
  notes: text("notes"),
  packagePhotoUrl: text("package_photo_url"),
  senderPhotoUrl: text("sender_photo_url"),
  dropoffPhotoUrl: text("dropoff_photo_url"),
  paymentId: text("payment_id").unique(),
  acceptedAt: timestamp("accepted_at"),
  pickedUpAt: timestamp("picked_up_at"),
  deliveredAt: timestamp("delivered_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertDeliverySchema = createInsertSchema(deliveriesTable).omit({
  id: true,
  status: true,
  courierId: true,
  estimatedPrice: true,
  distanceKm: true,
  pickupCode: true,
  acceptedAt: true,
  pickedUpAt: true,
  deliveredAt: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertDelivery = z.infer<typeof insertDeliverySchema>;
export type Delivery = typeof deliveriesTable.$inferSelect;
