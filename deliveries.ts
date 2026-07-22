import { Router, type IRouter } from "express";
import { eq, and, or, ne, sql } from "drizzle-orm";
import { db, deliveriesTable, usersTable, porterBoxesTable } from "@workspace/db";
import { sendPushNotification } from "../utils/notifications";
import { notifyPortersNewDelivery } from "../utils/porterNotifications";
import {
  CreateDeliveryBody,
  AcceptDeliveryBody,
  UpdateDeliveryStatusBody,
  GetDeliveryResponse,
  ListDeliveriesResponse,
  ListAvailableDeliveriesQueryParams,
  ListDeliveriesQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

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

function calculatePrice(distanceKm: number, packageSize: string): number {
  const base = 3.99;
  const perKm = 1.25;
  const sizeMultiplier: Record<string, number> = {
    small: 1.0,
    medium: 1.3,
    large: 1.6,
    extra_large: 2.0,
  };
  const multiplier = sizeMultiplier[packageSize] ?? 1.0;
  return Math.round((base + distanceKm * perKm) * multiplier * 100) / 100;
}

async function getDeliveryWithUsers(id: string) {
  const delivery = await db
    .select()
    .from(deliveriesTable)
    .where(eq(deliveriesTable.id, id))
    .limit(1);

  if (!delivery.length) return null;

  const d = delivery[0];
  const sender = await db
    .select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone, rating: usersTable.rating })
    .from(usersTable)
    .where(eq(usersTable.id, d.senderId))
    .limit(1);

  let courier = null;
  if (d.courierId) {
    const courierRows = await db
      .select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone, rating: usersTable.rating })
      .from(usersTable)
      .where(eq(usersTable.id, d.courierId))
      .limit(1);
    courier = courierRows[0] ?? null;
  }

  let porterBoxName: string | null = null;
  if (d.porterBoxId) {
    const [box] = await db
      .select({ name: porterBoxesTable.name })
      .from(porterBoxesTable)
      .where(eq(porterBoxesTable.id, d.porterBoxId))
      .limit(1);
    porterBoxName = box?.name ?? null;
  }

  return { ...d, sender: sender[0] ?? null, courier, porterBoxName };
}

router.get("/deliveries/available", async (req, res): Promise<void> => {
  const parsed = ListAvailableDeliveriesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { lat, lng, radiusKm = 10 } = parsed.data;

  const pending = await db
    .select()
    .from(deliveriesTable)
    .where(
      or(
        and(
          eq(deliveriesTable.status, "pending"),
          ne(deliveriesTable.deliveryType, "box_dropoff")
        ),
        and(
          eq(deliveriesTable.status, "in_box"),
          eq(deliveriesTable.deliveryType, "box_dropoff")
        )
      )
    );

  const nearby = pending.filter((d) => {
    const dist = calculateDistance(lat, lng, d.pickupLat, d.pickupLng);
    return dist <= radiusKm;
  });

  const withUsers = await Promise.all(
    nearby.map((d) => getDeliveryWithUsers(d.id))
  );

  res.json(
    ListDeliveriesResponse.parse({
      deliveries: withUsers.filter(Boolean),
    })
  );
});

router.get("/deliveries", async (req, res): Promise<void> => {
  const requestingUserId = (req as any).user?.id as string | undefined;
  if (!requestingUserId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = ListDeliveriesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { senderId, courierId, status, limit } = parsed.data;
  const limitNum = limit ?? 20;

  if (senderId && senderId !== requestingUserId) {
    res.status(403).json({ error: "You can only list your own deliveries" });
    return;
  }
  if (courierId && courierId !== requestingUserId) {
    res.status(403).json({ error: "You can only list your own deliveries" });
    return;
  }
  if (!senderId && !courierId) {
    res.status(400).json({ error: "senderId or courierId is required" });
    return;
  }

  const conditions = [];
  if (senderId) conditions.push(eq(deliveriesTable.senderId, senderId));
  if (courierId) conditions.push(eq(deliveriesTable.courierId, courierId));
  if (status) conditions.push(eq(deliveriesTable.status, status));

  const deliveries = await db
    .select()
    .from(deliveriesTable)
    .where(and(...conditions))
    .orderBy(sql`${deliveriesTable.createdAt} DESC`)
    .limit(limitNum);

  const withUsers = await Promise.all(
    deliveries.map((d) => getDeliveryWithUsers(d.id))
  );

  res.json(
    ListDeliveriesResponse.parse({
      deliveries: withUsers.filter(Boolean),
    })
  );
});

router.post("/deliveries", async (req, res): Promise<void> => {
  const parsed = CreateDeliveryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { pickupLat, pickupLng, dropoffLat, dropoffLng, packageSize } = parsed.data;
  const distanceKm = calculateDistance(pickupLat, pickupLng, dropoffLat, dropoffLng);
  const estimatedPrice = calculatePrice(distanceKm, packageSize);

  const [delivery] = await db
    .insert(deliveriesTable)
    .values({
      senderId: parsed.data.senderId,
      packageSize: parsed.data.packageSize,
      packageDescription: parsed.data.packageDescription,
      pickupAddress: parsed.data.pickupAddress,
      pickupLat: parsed.data.pickupLat,
      pickupLng: parsed.data.pickupLng,
      dropoffAddress: parsed.data.dropoffAddress,
      dropoffLat: parsed.data.dropoffLat,
      dropoffLng: parsed.data.dropoffLng,
      notes: parsed.data.notes,
      deliveryType: parsed.data.deliveryType,
      porterBoxId: parsed.data.porterBoxId,
      senderPhotoUrl: parsed.data.senderPhotoUrl ?? null,
      distanceKm: Math.round(distanceKm * 10) / 10,
      estimatedPrice,
    })
    .returning();

  const full = await getDeliveryWithUsers(delivery.id);
  res.status(201).json(GetDeliveryResponse.parse(full));

  if (parsed.data.deliveryType !== "box_dropoff") {
    notifyPortersNewDelivery(delivery.id);
  }
});

router.get("/deliveries/:id", async (req, res): Promise<void> => {
  const requestingUserId = (req as any).user?.id as string | undefined;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const delivery = await getDeliveryWithUsers(id);

  if (!delivery) {
    res.status(404).json({ error: "Delivery not found" });
    return;
  }

  if (
    requestingUserId &&
    delivery.senderId !== requestingUserId &&
    delivery.courierId !== requestingUserId
  ) {
    res.status(403).json({ error: "You do not have access to this delivery" });
    return;
  }

  res.json(GetDeliveryResponse.parse(delivery));
});

router.post("/deliveries/:id/accept", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const parsed = AcceptDeliveryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await db
    .select()
    .from(deliveriesTable)
    .where(eq(deliveriesTable.id, id))
    .limit(1);

  if (!existing.length) {
    res.status(404).json({ error: "Delivery not found" });
    return;
  }

  const isAcceptable =
    existing[0].status === "pending" ||
    (existing[0].status === "in_box" && existing[0].deliveryType === "box_dropoff");

  if (!isAcceptable) {
    res.status(409).json({ error: "Delivery is no longer available" });
    return;
  }

  await db
    .update(deliveriesTable)
    .set({
      courierId: parsed.data.courierId,
      status: "accepted",
      acceptedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(deliveriesTable.id, id));

  const full = await getDeliveryWithUsers(id);
  res.json(GetDeliveryResponse.parse(full));

  try {
    const [sender] = await db
      .select({ pushToken: usersTable.pushToken })
      .from(usersTable)
      .where(eq(usersTable.id, existing[0].senderId))
      .limit(1);
    await sendPushNotification(sender?.pushToken, {
      title: "Porter Found!",
      body: "Porter found! They're on the way.",
      data: { deliveryId: id },
    });
  } catch {}
});

router.patch("/deliveries/:id/status", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const parsed = UpdateDeliveryStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { status, dropoffPhotoUrl } = parsed.data;

  if ((status === "delivered" || status === "in_box") && !dropoffPhotoUrl) {
    res.status(400).json({ error: "A drop-off photo is required to mark as delivered or dropped at box" });
    return;
  }

  if (status === "picked_up") {
    await db
      .update(deliveriesTable)
      .set({ status, pickedUpAt: new Date(), updatedAt: new Date() })
      .where(eq(deliveriesTable.id, id));

    try {
      const [delivery] = await db
        .select({ senderId: deliveriesTable.senderId })
        .from(deliveriesTable)
        .where(eq(deliveriesTable.id, id))
        .limit(1);
      if (delivery?.senderId) {
        const [sender] = await db
          .select({ pushToken: usersTable.pushToken })
          .from(usersTable)
          .where(eq(usersTable.id, delivery.senderId))
          .limit(1);
        await sendPushNotification(sender?.pushToken, {
          title: "Package Picked Up!",
          body: "Your package is on its way!",
          data: { deliveryId: id },
        });
      }
    } catch {}
  } else if (status === "delivered") {
    await db
      .update(deliveriesTable)
      .set({
        status,
        deliveredAt: new Date(),
        updatedAt: new Date(),
        ...(dropoffPhotoUrl ? { dropoffPhotoUrl } : {}),
      })
      .where(eq(deliveriesTable.id, id));

    const existing = await db
      .select()
      .from(deliveriesTable)
      .where(eq(deliveriesTable.id, id))
      .limit(1);

    if (existing[0]?.courierId) {
      await db
        .update(usersTable)
        .set({
          totalDeliveries: sql`${usersTable.totalDeliveries} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(usersTable.id, existing[0].courierId));
    }

    try {
      if (existing[0]?.senderId) {
        const [sender] = await db
          .select({ pushToken: usersTable.pushToken })
          .from(usersTable)
          .where(eq(usersTable.id, existing[0].senderId))
          .limit(1);
        await sendPushNotification(sender?.pushToken, {
          title: "Delivered!",
          body: "Delivered! Your package has arrived.",
          data: { deliveryId: id },
        });
      }
    } catch {}
  } else if (status === "in_box") {
    await db
      .update(deliveriesTable)
      .set({
        status,
        deliveredAt: new Date(),
        updatedAt: new Date(),
        ...(dropoffPhotoUrl ? { dropoffPhotoUrl } : {}),
      })
      .where(eq(deliveriesTable.id, id));
  } else {
    await db
      .update(deliveriesTable)
      .set({ status, updatedAt: new Date() })
      .where(eq(deliveriesTable.id, id));
  }

  const full = await getDeliveryWithUsers(id);
  if (!full) {
    res.status(404).json({ error: "Delivery not found" });
    return;
  }

  res.json(GetDeliveryResponse.parse(full));
});

router.post("/deliveries/:id/photo", async (req, res): Promise<void> => {
  const requestingUserId = (req as any).user?.id as string | undefined;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { photoBase64, mimeType } = req.body as { photoBase64?: string; mimeType?: string };

  if (!photoBase64) {
    res.status(400).json({ error: "photoBase64 is required" });
    return;
  }

  const [delivery] = await db
    .select()
    .from(deliveriesTable)
    .where(eq(deliveriesTable.id, id))
    .limit(1);

  if (!delivery) {
    res.status(404).json({ error: "Delivery not found" });
    return;
  }

  if (!requestingUserId || delivery.senderId !== requestingUserId) {
    res.status(403).json({ error: "Only the package sender can upload a photo" });
    return;
  }

  const mime = mimeType ?? "image/jpeg";
  const packagePhotoUrl = `data:${mime};base64,${photoBase64}`;

  await db
    .update(deliveriesTable)
    .set({ packagePhotoUrl, updatedAt: new Date() })
    .where(eq(deliveriesTable.id, id));

  res.json({ success: true, packagePhotoUrl });
});

router.post("/deliveries/:id/rate", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { rating } = req.body as { rating: number; comment?: string };

  if (!rating || rating < 1 || rating > 5) {
    res.status(400).json({ error: "Rating must be 1–5" });
    return;
  }

  const [delivery] = await db
    .select()
    .from(deliveriesTable)
    .where(eq(deliveriesTable.id, id))
    .limit(1);

  if (!delivery) {
    res.status(404).json({ error: "Delivery not found" });
    return;
  }

  if (delivery.courierId) {
    const [courier] = await db
      .select({ rating: usersTable.rating, totalDeliveries: usersTable.totalDeliveries })
      .from(usersTable)
      .where(eq(usersTable.id, delivery.courierId))
      .limit(1);

    if (courier) {
      const prevRating = courier.rating ?? 4.5;
      const count = courier.totalDeliveries ?? 1;
      const newRating = Math.round(((prevRating * count + rating) / (count + 1)) * 10) / 10;
      await db
        .update(usersTable)
        .set({ rating: newRating, updatedAt: new Date() })
        .where(eq(usersTable.id, delivery.courierId));
    }
  }

  res.json({ success: true });
});

export default router;
