import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, deliveriesTable, usersTable } from "@workspace/db";
import { GetDeliveryTrackingResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/tracking/:deliveryId", async (req, res): Promise<void> => {
  const deliveryId = Array.isArray(req.params.deliveryId)
    ? req.params.deliveryId[0]
    : req.params.deliveryId;

  const [delivery] = await db
    .select()
    .from(deliveriesTable)
    .where(eq(deliveriesTable.id, deliveryId))
    .limit(1);

  if (!delivery) {
    res.status(404).json({ error: "Delivery not found" });
    return;
  }

  let courierLat: number | null = null;
  let courierLng: number | null = null;
  let courierName: string | null = null;
  let lastUpdated: Date | null = null;

  if (delivery.courierId) {
    const [courier] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, delivery.courierId))
      .limit(1);

    if (courier) {
      courierLat = courier.currentLat ?? null;
      courierLng = courier.currentLng ?? null;
      courierName = courier.name;
      lastUpdated = courier.updatedAt;
    }
  }

  res.json(
    GetDeliveryTrackingResponse.parse({
      deliveryId: delivery.id,
      status: delivery.status,
      courierLat,
      courierLng,
      courierName,
      lastUpdated,
    })
  );
});

export default router;
