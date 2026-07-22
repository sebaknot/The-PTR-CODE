import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, deliveriesTable, usersTable } from "@workspace/db";

const router: IRouter = Router();

const DEMO_ROUTE = [
  { lat: 40.7589, lng: -73.9851, label: "Times Square (Pickup)" },
  { lat: 40.7549, lng: -73.9840 },
  { lat: 40.7505, lng: -73.9934 },
  { lat: 40.7484, lng: -73.9967, label: "Penn Station" },
  { lat: 40.7463, lng: -73.9994 },
  { lat: 40.7441, lng: -74.0023 },
  { lat: 40.7411, lng: -74.0018, label: "Chelsea Market (Dropoff)" },
];

const DEMO_DEVICE_SENDER = "demo-sender-device-001";
const DEMO_DEVICE_COURIER = "demo-courier-device-001";

const activeSimulations = new Map<string, ReturnType<typeof setInterval>>();

router.post("/demo/seed", async (_req, res): Promise<void> => {
  try {
    let sender = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.deviceId, DEMO_DEVICE_SENDER))
      .limit(1)
      .then((r) => r[0]);

    if (!sender) {
      [sender] = await db
        .insert(usersTable)
        .values({
          deviceId: DEMO_DEVICE_SENDER,
          name: "Alex Demo",
          phone: "+1 (555) 000-0001",
          role: "sender",
          isOnline: false,
        })
        .returning();
    }

    let courier = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.deviceId, DEMO_DEVICE_COURIER))
      .limit(1)
      .then((r) => r[0]);

    if (!courier) {
      [courier] = await db
        .insert(usersTable)
        .values({
          deviceId: DEMO_DEVICE_COURIER,
          name: "Jordan Swift",
          phone: "+1 (555) 000-0002",
          role: "courier",
          isOnline: true,
          currentLat: DEMO_ROUTE[0].lat,
          currentLng: DEMO_ROUTE[0].lng,
          rating: 4.9,
          totalDeliveries: 142,
        })
        .returning();
    } else {
      await db
        .update(usersTable)
        .set({
          currentLat: DEMO_ROUTE[0].lat,
          currentLng: DEMO_ROUTE[0].lng,
          isOnline: true,
        })
        .where(eq(usersTable.id, courier.id));
    }

    const pickup = DEMO_ROUTE[0];
    const dropoff = DEMO_ROUTE[DEMO_ROUTE.length - 1];

    const [delivery] = await db
      .insert(deliveriesTable)
      .values({
        senderId: sender.id,
        courierId: courier.id,
        packageSize: "medium",
        packageDescription: "Demo Package (Electronics)",
        pickupAddress: "Times Square, New York, NY 10036",
        pickupLat: pickup.lat,
        pickupLng: pickup.lng,
        dropoffAddress: "Chelsea Market, 75 9th Ave, New York, NY 10011",
        dropoffLat: dropoff.lat,
        dropoffLng: dropoff.lng,
        distanceKm: 2.4,
        estimatedPrice: 10.99,
        status: "accepted",
        notes: "Demo delivery — courier is moving in real time!",
      })
      .returning();

    if (activeSimulations.has(delivery.id)) {
      clearInterval(activeSimulations.get(delivery.id)!);
    }

    let step = 0;
    const interval = setInterval(async () => {
      if (step >= DEMO_ROUTE.length) {
        clearInterval(interval);
        activeSimulations.delete(delivery.id);
        await db
          .update(deliveriesTable)
          .set({ status: "delivered" })
          .where(eq(deliveriesTable.id, delivery.id));
        return;
      }

      const point = DEMO_ROUTE[step];
      await db
        .update(usersTable)
        .set({ currentLat: point.lat, currentLng: point.lng, updatedAt: new Date() })
        .where(eq(usersTable.id, courier!.id));

      if (step === 3) {
        await db
          .update(deliveriesTable)
          .set({ status: "picked_up" })
          .where(eq(deliveriesTable.id, delivery.id));
      }

      step++;
    }, 4000);

    activeSimulations.set(delivery.id, interval);

    res.json({
      deliveryId: delivery.id,
      courierId: courier.id,
      route: DEMO_ROUTE,
      message: "Demo started! Courier is moving every 4 seconds.",
    });
  } catch (err) {
    console.error("Demo seed error:", err);
    res.status(500).json({ error: "Failed to seed demo data" });
  }
});

export default router;
