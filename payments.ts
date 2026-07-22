import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, deliveriesTable } from "@workspace/db";
import { getUncachableStripeClient, getStripePublishableKey } from "../stripeClient";
import { notifyPortersNewDelivery } from "../utils/porterNotifications";

type PackageSize = "small" | "medium" | "large" | "extra_large";
type DeliveryType = "standard" | "porter_box" | "box_dropoff";

function parseDeliveryType(value: string | undefined): DeliveryType {
  if (value === "porter_box" || value === "box_dropoff") return value;
  return "standard";
}

function generateDropoffCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

const VALID_PACKAGE_SIZES: readonly PackageSize[] = ["small", "medium", "large", "extra_large"];

function isValidPackageSize(value: string): value is PackageSize {
  return (VALID_PACKAGE_SIZES as readonly string[]).includes(value);
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

export const paymentsPublicRouter: IRouter = Router();

paymentsPublicRouter.get("/payments/config", async (_req, res): Promise<void> => {
  try {
    const publishableKey = await getStripePublishableKey();
    res.json({ publishableKey });
  } catch (err: unknown) {
    res.status(500).json({ error: toMessage(err) });
  }
});

const router: IRouter = Router();

function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculatePrice(distanceKm: number, packageSize: string, deliveryType?: string): number {
  const sizeMultiplier: Record<string, number> = {
    small: 1.0, medium: 1.3, large: 1.6, extra_large: 2.0,
  };
  const base = Math.round((3.99 + distanceKm * 1.25) * (sizeMultiplier[packageSize] ?? 1.0) * 100) / 100;
  const discount = deliveryType === "box_dropoff" ? 0.85 : 1.0;
  return Math.round(base * discount * 100) / 100;
}

router.post("/payments/intent", async (req, res): Promise<void> => {
  const { deliveryData } = req.body as {
    deliveryData: {
      packageSize: string;
      packageDescription: string;
      pickupAddress: string;
      pickupLat: number;
      pickupLng: number;
      dropoffAddress: string;
      dropoffLat: number;
      dropoffLng: number;
      notes?: string;
      deliveryType?: string;
      porterBoxId?: string;
      senderPhotoUrl?: string;
    };
  };
  const userId = (req as any).user?.id as string | undefined;

  if (!userId || !deliveryData) {
    res.status(400).json({ error: "userId and deliveryData are required" });
    return;
  }

  try {
    const stripe = await getUncachableStripeClient();

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: user.name,
        phone: user.phone,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
      await db
        .update(usersTable)
        .set({ stripeCustomerId: customerId, updatedAt: new Date() })
        .where(eq(usersTable.id, userId));
    }

    const distanceKm = calculateDistance(
      deliveryData.pickupLat, deliveryData.pickupLng,
      deliveryData.dropoffLat, deliveryData.dropoffLng,
    );
    const expectedPrice = calculatePrice(distanceKm, deliveryData.packageSize, deliveryData.deliveryType);
    const expectedCents = Math.round(expectedPrice * 100);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: expectedCents,
      currency: "usd",
      customer: customerId,
      automatic_payment_methods: { enabled: true },
      metadata: {
        userId,
        expectedCents: String(expectedCents),
        packageSize: deliveryData.packageSize,
        packageDescription: deliveryData.packageDescription.substring(0, 490),
        pickupAddress: deliveryData.pickupAddress.substring(0, 490),
        pickupLat: String(deliveryData.pickupLat),
        pickupLng: String(deliveryData.pickupLng),
        dropoffAddress: deliveryData.dropoffAddress.substring(0, 490),
        dropoffLat: String(deliveryData.dropoffLat),
        dropoffLng: String(deliveryData.dropoffLng),
        notes: (deliveryData.notes ?? "").substring(0, 490),
        deliveryType: deliveryData.deliveryType ?? "standard",
        porterBoxId: deliveryData.porterBoxId ?? "",
        senderPhotoUrl: (deliveryData.senderPhotoUrl ?? "").substring(0, 490),
      },
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amountCents: expectedCents,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: toMessage(err) });
  }
});

paymentsPublicRouter.post("/payments/complete-intent", async (req, res): Promise<void> => {
  const { paymentIntentId } = req.body as { paymentIntentId: string };

  if (!paymentIntentId) {
    res.status(400).json({ error: "paymentIntentId is required" });
    return;
  }

  try {
    const stripe = await getUncachableStripeClient();
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (intent.status !== "succeeded") {
      res.status(402).json({ error: "Payment not completed", status: intent.status });
      return;
    }

    const meta = intent.metadata ?? {};
    const userId = meta.userId;
    if (!userId) {
      res.status(400).json({ error: "Intent missing user metadata" });
      return;
    }

    const expectedCents = parseInt(meta.expectedCents ?? "0", 10);
    if (expectedCents > 0 && intent.amount_received < expectedCents) {
      res.status(402).json({ error: "Payment amount insufficient", expected: expectedCents, received: intent.amount_received });
      return;
    }

    const pickupLat = parseFloat(meta.pickupLat ?? "0");
    const pickupLng = parseFloat(meta.pickupLng ?? "0");
    const dropoffLat = parseFloat(meta.dropoffLat ?? "0");
    const dropoffLng = parseFloat(meta.dropoffLng ?? "0");
    const rawSize = meta.packageSize ?? "small";
    const packageSize: PackageSize = isValidPackageSize(rawSize) ? rawSize : "small";

    const distanceKm = calculateDistance(pickupLat, pickupLng, dropoffLat, dropoffLng);
    const estimatedPrice = calculatePrice(distanceKm, packageSize, meta.deliveryType);

    try {
      const [delivery] = await db
        .insert(deliveriesTable)
        .values({
          senderId: userId,
          packageSize,
          packageDescription: meta.packageDescription ?? "",
          pickupAddress: meta.pickupAddress ?? "",
          pickupLat,
          pickupLng,
          dropoffAddress: meta.dropoffAddress ?? "",
          dropoffLat,
          dropoffLng,
          notes: meta.notes || undefined,
          distanceKm: Math.round(distanceKm * 10) / 10,
          estimatedPrice,
          paymentId: paymentIntentId,
          deliveryType: parseDeliveryType(meta.deliveryType) as "standard" | "porter_box" | "box_dropoff",
          porterBoxId: meta.porterBoxId || undefined,
          pickupCode: meta.deliveryType === "box_dropoff" ? generateDropoffCode() : undefined,
          senderPhotoUrl: meta.senderPhotoUrl || undefined,
        })
        .returning();
      res.status(201).json({ delivery });
      if (delivery.deliveryType !== "box_dropoff") {
        notifyPortersNewDelivery(delivery.id);
      }
    } catch (insertErr: unknown) {
      if ((insertErr as { code?: string }).code === "23505") {
        const [existing] = await db
          .select()
          .from(deliveriesTable)
          .where(eq(deliveriesTable.paymentId, paymentIntentId))
          .limit(1);
        res.status(200).json({ delivery: existing });
        return;
      }
      throw insertErr;
    }
  } catch (err: unknown) {
    res.status(500).json({ error: toMessage(err) });
  }
});

router.post("/payments/dev-bypass", async (req, res): Promise<void> => {
  if (process.env.NODE_ENV === "production") {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const { deliveryData } = req.body as {
    deliveryData: {
      packageSize: string;
      packageDescription: string;
      pickupAddress: string;
      pickupLat: number;
      pickupLng: number;
      dropoffAddress: string;
      dropoffLat: number;
      dropoffLng: number;
      notes?: string;
      deliveryType?: string;
      porterBoxId?: string;
      senderPhotoUrl?: string;
    };
  };
  const userId = (req as any).user?.id as string | undefined;

  if (!userId || !deliveryData) {
    res.status(400).json({ error: "userId and deliveryData are required" });
    return;
  }

  const rawSize = deliveryData.packageSize;
  const packageSize: PackageSize = isValidPackageSize(rawSize) ? rawSize : "small";

  const distanceKm = calculateDistance(
    deliveryData.pickupLat, deliveryData.pickupLng,
    deliveryData.dropoffLat, deliveryData.dropoffLng,
  );
  const estimatedPrice = calculatePrice(distanceKm, packageSize, deliveryData.deliveryType);

  try {
    const [delivery] = await db
      .insert(deliveriesTable)
      .values({
        senderId: userId,
        packageSize,
        packageDescription: deliveryData.packageDescription,
        pickupAddress: deliveryData.pickupAddress,
        pickupLat: deliveryData.pickupLat,
        pickupLng: deliveryData.pickupLng,
        dropoffAddress: deliveryData.dropoffAddress,
        dropoffLat: deliveryData.dropoffLat,
        dropoffLng: deliveryData.dropoffLng,
        notes: deliveryData.notes || undefined,
        distanceKm: Math.round(distanceKm * 10) / 10,
        estimatedPrice,
        paymentId: `dev_bypass_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        deliveryType: parseDeliveryType(deliveryData.deliveryType),
        porterBoxId: deliveryData.porterBoxId || undefined,
        pickupCode: deliveryData.deliveryType === "box_dropoff" ? generateDropoffCode() : undefined,
        senderPhotoUrl: deliveryData.senderPhotoUrl || undefined,
      })
      .returning();
    res.status(201).json({ delivery });
    if (delivery.deliveryType !== "box_dropoff") {
      notifyPortersNewDelivery(delivery.id);
    }
  } catch (err: unknown) {
    res.status(500).json({ error: toMessage(err) });
  }
});

router.post("/payments/checkout-session", async (req, res): Promise<void> => {
  const { deliveryData } = req.body as {
    deliveryData: {
      packageSize: string;
      packageDescription: string;
      pickupAddress: string;
      pickupLat: number;
      pickupLng: number;
      dropoffAddress: string;
      dropoffLat: number;
      dropoffLng: number;
      notes?: string;
      deliveryType?: string;
      porterBoxId?: string;
      senderPhotoUrl?: string;
    };
  };
  const userId = (req as any).user?.id as string | undefined;

  if (!userId || !deliveryData) {
    res.status(400).json({ error: "userId and deliveryData are required" });
    return;
  }

  try {
    const stripe = await getUncachableStripeClient();

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: user.name,
        phone: user.phone,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
      await db
        .update(usersTable)
        .set({ stripeCustomerId: customerId, updatedAt: new Date() })
        .where(eq(usersTable.id, userId));
    }

    const distanceKm = calculateDistance(
      deliveryData.pickupLat, deliveryData.pickupLng,
      deliveryData.dropoffLat, deliveryData.dropoffLng,
    );
    const expectedPrice = calculatePrice(distanceKm, deliveryData.packageSize, deliveryData.deliveryType);
    const expectedCents = Math.round(expectedPrice * 100);

    const frontendUrl = process.env.FRONTEND_URL ?? process.env.APP_URL;
    if (!frontendUrl) {
      res.status(500).json({ error: "FRONTEND_URL environment variable is required" });
      return;
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: expectedCents,
            product_data: {
              name: `Porter — ${deliveryData.packageSize} package`,
              description: deliveryData.packageDescription,
            },
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      ui_mode: "embedded",
      return_url: `${frontendUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      metadata: {
        userId,
        expectedCents: String(expectedCents),
        packageSize: deliveryData.packageSize,
        packageDescription: deliveryData.packageDescription.substring(0, 490),
        pickupAddress: deliveryData.pickupAddress.substring(0, 490),
        pickupLat: String(deliveryData.pickupLat),
        pickupLng: String(deliveryData.pickupLng),
        dropoffAddress: deliveryData.dropoffAddress.substring(0, 490),
        dropoffLat: String(deliveryData.dropoffLat),
        dropoffLng: String(deliveryData.dropoffLng),
        notes: (deliveryData.notes ?? "").substring(0, 490),
        deliveryType: deliveryData.deliveryType ?? "standard",
        porterBoxId: deliveryData.porterBoxId ?? "",
        senderPhotoUrl: (deliveryData.senderPhotoUrl ?? "").substring(0, 490),
      },
    });

    res.json({ clientSecret: session.client_secret, sessionId: session.id, amountCents: expectedCents, publishableKey: process.env.STRIPE_PUBLISHABLE_KEY });
  } catch (err: unknown) {
    res.status(500).json({ error: toMessage(err) });
  }
});

paymentsPublicRouter.post("/payments/complete", async (req, res): Promise<void> => {
  const { sessionId } = req.body as { sessionId: string };

  if (!sessionId) {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }

  try {
    const stripe = await getUncachableStripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid") {
      res.status(402).json({ error: "Payment not completed", status: session.payment_status });
      return;
    }

    const meta = session.metadata ?? {};
    const userId = meta.userId;
    if (!userId) {
      res.status(400).json({ error: "Session missing user metadata" });
      return;
    }

    const expectedCents = parseInt(meta.expectedCents ?? "0", 10);
    if (expectedCents > 0 && (session.amount_total ?? 0) < expectedCents) {
      res.status(402).json({ error: "Payment amount insufficient", expected: expectedCents, received: session.amount_total });
      return;
    }

    const pickupLat = parseFloat(meta.pickupLat ?? "0");
    const pickupLng = parseFloat(meta.pickupLng ?? "0");
    const dropoffLat = parseFloat(meta.dropoffLat ?? "0");
    const dropoffLng = parseFloat(meta.dropoffLng ?? "0");
    const rawSize = meta.packageSize ?? "small";
    const packageSize: PackageSize = isValidPackageSize(rawSize) ? rawSize : "small";

    const distanceKm = calculateDistance(pickupLat, pickupLng, dropoffLat, dropoffLng);
    const estimatedPrice = calculatePrice(distanceKm, packageSize, meta.deliveryType);

    try {
      const [delivery] = await db
        .insert(deliveriesTable)
        .values({
          senderId: userId,
          packageSize,
          packageDescription: meta.packageDescription ?? "",
          pickupAddress: meta.pickupAddress ?? "",
          pickupLat,
          pickupLng,
          dropoffAddress: meta.dropoffAddress ?? "",
          dropoffLat,
          dropoffLng,
          notes: meta.notes || undefined,
          distanceKm: Math.round(distanceKm * 10) / 10,
          estimatedPrice,
          paymentId: sessionId,
          deliveryType: parseDeliveryType(meta.deliveryType) as "standard" | "porter_box" | "box_dropoff",
          porterBoxId: meta.porterBoxId || undefined,
          pickupCode: meta.deliveryType === "box_dropoff" ? generateDropoffCode() : undefined,
          senderPhotoUrl: meta.senderPhotoUrl || undefined,
        })
        .returning();
      res.status(201).json({ delivery });
      if (delivery.deliveryType !== "box_dropoff") {
        notifyPortersNewDelivery(delivery.id);
      }
    } catch (insertErr: unknown) {
      if ((insertErr as { code?: string }).code === "23505") {
        const [existing] = await db
          .select()
          .from(deliveriesTable)
          .where(eq(deliveriesTable.paymentId, sessionId))
          .limit(1);
        res.status(200).json({ delivery: existing });
        return;
      }
      throw insertErr;
    }
  } catch (err: unknown) {
    res.status(500).json({ error: toMessage(err) });
  }
});

export default router;
