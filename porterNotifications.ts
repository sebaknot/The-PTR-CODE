import { and, eq, isNotNull } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { sendPushNotifications } from "./notifications";

async function getPorterTokens(): Promise<string[]> {
  const porters = await db
    .select({ pushToken: usersTable.pushToken })
    .from(usersTable)
    .where(and(eq(usersTable.role, "courier"), isNotNull(usersTable.pushToken)));
  return porters.map((p) => p.pushToken!).filter(Boolean);
}

export async function notifyPortersNewDelivery(deliveryId: string): Promise<void> {
  try {
    const tokens = await getPorterTokens();
    await sendPushNotifications(tokens, {
      title: "New Delivery Request Nearby!",
      body: "A new package needs a porter. Tap to view and accept.",
      data: { deliveryId },
    });
  } catch (err) {
    console.warn("[push] notifyPortersNewDelivery failed:", err instanceof Error ? err.message : String(err));
  }
}

export async function notifyPortersBoxDropoffReady(deliveryId: string): Promise<void> {
  try {
    const tokens = await getPorterTokens();
    await sendPushNotifications(tokens, {
      title: "Package Ready for Pickup",
      body: "A sender confirmed their box drop-off. Tap to claim this delivery.",
      data: { deliveryId },
    });
  } catch (err) {
    console.warn("[push] notifyPortersBoxDropoffReady failed:", err instanceof Error ? err.message : String(err));
  }
}
