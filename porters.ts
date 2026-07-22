import { Router, type IRouter, type Request } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  UpdateCourierLocationBody,
  UpdateCourierAvailabilityBody,
  UpdateCourierLocationResponse,
  UpdateCourierAvailabilityResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function findCourier(idParam: string) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idParam);
  if (isUuid) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, idParam));
    return user ?? null;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.deviceId, idParam));
  return user ?? null;
}

router.patch("/porters/:courierId/location", async (req: Request & { user?: typeof usersTable.$inferSelect }, res): Promise<void> => {
  const courierId = Array.isArray(req.params.courierId)
    ? req.params.courierId[0]
    : req.params.courierId;

  const existing = await findCourier(courierId);
  if (!existing) {
    res.status(404).json({ error: "Porter not found" });
    return;
  }

  if (req.user?.id !== existing.id) {
    res.status(403).json({ error: "Forbidden: cannot update another porter's location" });
    return;
  }

  const parsed = UpdateCourierLocationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [user] = await db
    .update(usersTable)
    .set({
      currentLat: parsed.data.lat,
      currentLng: parsed.data.lng,
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, existing.id))
    .returning();

  res.json(
    UpdateCourierLocationResponse.parse({
      deviceId: user.deviceId ?? user.id,
      lat: user.currentLat,
      lng: user.currentLng,
      updatedAt: user.updatedAt,
    })
  );
});

router.patch("/porters/:courierId/availability", async (req: Request & { user?: typeof usersTable.$inferSelect }, res): Promise<void> => {
  const courierId = Array.isArray(req.params.courierId)
    ? req.params.courierId[0]
    : req.params.courierId;

  const existing = await findCourier(courierId);
  if (!existing) {
    res.status(404).json({ error: "Porter not found" });
    return;
  }

  if (req.user?.id !== existing.id) {
    res.status(403).json({ error: "Forbidden: cannot update another porter's availability" });
    return;
  }

  const parsed = UpdateCourierAvailabilityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [user] = await db
    .update(usersTable)
    .set({ isOnline: parsed.data.isOnline, updatedAt: new Date() })
    .where(eq(usersTable.id, existing.id))
    .returning();

  res.json(UpdateCourierAvailabilityResponse.parse(user));
});

export default router;
