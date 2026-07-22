import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, porterBoxesTable, deliveriesTable } from "@workspace/db";
import { notifyPortersBoxDropoffReady } from "../utils/porterNotifications";
import { z } from "zod";

const router: IRouter = Router();

function generatePickupCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const ListBoxesQuery = z.object({
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
  dropoffLat: z.coerce.number().optional(),
  dropoffLng: z.coerce.number().optional(),
});

router.get("/porter-boxes", async (req, res): Promise<void> => {
  const parsed = ListBoxesQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const boxes = await db
    .select()
    .from(porterBoxesTable)
    .where(eq(porterBoxesTable.isActive, true));

  const { lat, lng, dropoffLat, dropoffLng } = parsed.data;

  // Only use dropoff coords for sorting when BOTH are provided; else fall back to pickup
  const hasDropoff = dropoffLat != null && dropoffLng != null;
  const sortLat = hasDropoff ? dropoffLat : lat;
  const sortLng = hasDropoff ? dropoffLng : lng;

  let result = boxes.map((b) => ({
    ...b,
    distanceKm: sortLat != null && sortLng != null
      ? Math.round(calculateDistance(sortLat, sortLng, b.lat, b.lng) * 10) / 10
      : null,
  }));

  if (sortLat != null && sortLng != null) {
    result = result.sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
  }

  res.json({ boxes: result });
});

router.post("/deliveries/:id/drop-at-box", async (req, res): Promise<void> => {
  const requestingUserId = (req as any).user?.id as string | undefined;
  const deliveryId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const [delivery] = await db
    .select()
    .from(deliveriesTable)
    .where(eq(deliveriesTable.id, deliveryId))
    .limit(1);

  if (!delivery) {
    res.status(404).json({ error: "Delivery not found" });
    return;
  }

  if (!requestingUserId || delivery.courierId !== requestingUserId) {
    res.status(403).json({ error: "Only the assigned porter can drop this delivery at a box" });
    return;
  }

  if (delivery.status !== "picked_up") {
    res.status(409).json({ error: "Delivery must be in picked_up status to drop at box" });
    return;
  }

  if (delivery.deliveryType !== "porter_box") {
    res.status(409).json({ error: "This delivery is not a porter box delivery" });
    return;
  }

  const pickupCode = generatePickupCode();
  const { dropoffPhotoUrl } = req.body as { dropoffPhotoUrl?: string };

  await db
    .update(deliveriesTable)
    .set({
      status: "in_box",
      pickupCode,
      updatedAt: new Date(),
      ...(dropoffPhotoUrl ? { dropoffPhotoUrl } : {}),
    })
    .where(eq(deliveriesTable.id, deliveryId));

  res.json({ success: true, pickupCode, deliveryId });
});

router.post("/deliveries/:id/confirm-deposit", async (req, res): Promise<void> => {
  const requestingUserId = (req as any).user?.id as string | undefined;
  const deliveryId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const [delivery] = await db
    .select()
    .from(deliveriesTable)
    .where(eq(deliveriesTable.id, deliveryId))
    .limit(1);

  if (!delivery) {
    res.status(404).json({ error: "Delivery not found" });
    return;
  }

  if (!requestingUserId || delivery.senderId !== requestingUserId) {
    res.status(403).json({ error: "Only the sender can confirm deposit" });
    return;
  }

  if (delivery.deliveryType !== "box_dropoff") {
    res.status(409).json({ error: "This endpoint is only for box drop-off deliveries" });
    return;
  }

  if (delivery.status !== "pending") {
    res.status(409).json({ error: "Delivery must be in pending status to confirm deposit" });
    return;
  }

  const pickupCode = generatePickupCode();

  await db
    .update(deliveriesTable)
    .set({
      status: "in_box",
      pickupCode,
      updatedAt: new Date(),
    })
    .where(eq(deliveriesTable.id, deliveryId));

  res.json({ success: true, pickupCode });

  notifyPortersBoxDropoffReady(deliveryId);
});

const BoxPickupBody = z.object({
  deliveryId: z.string(),
  code: z.string(),
});

router.post("/porter-boxes/pickup", async (req, res): Promise<void> => {
  const requestingUserId = (req as any).user?.id as string | undefined;
  const parsed = BoxPickupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { deliveryId, code } = parsed.data;

  const [delivery] = await db
    .select()
    .from(deliveriesTable)
    .where(eq(deliveriesTable.id, deliveryId))
    .limit(1);

  if (!delivery) {
    res.status(404).json({ error: "Delivery not found" });
    return;
  }

  if (!requestingUserId || delivery.senderId !== requestingUserId) {
    res.status(403).json({ error: "Only the package sender can confirm pickup" });
    return;
  }

  if (delivery.status !== "in_box") {
    res.status(409).json({ error: "Package is not currently in a box" });
    return;
  }

  if (delivery.pickupCode?.toUpperCase() !== code.toUpperCase()) {
    res.status(400).json({ error: "Incorrect pickup code" });
    return;
  }

  await db
    .update(deliveriesTable)
    .set({
      status: "delivered",
      deliveredAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(deliveriesTable.id, deliveryId));

  res.json({ success: true, message: "Package collected successfully!" });
});

export default router;
