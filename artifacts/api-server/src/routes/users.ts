import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  CreateUserBody,
  UpdateUserBody,
  GetUserResponse,
  UpdateUserResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/users", async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.deviceId, parsed.data.deviceId))
    .limit(1);

  if (existing.length > 0) {
    const updated = await db
      .update(usersTable)
      .set({
        name: parsed.data.name,
        phone: parsed.data.phone,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.deviceId, parsed.data.deviceId))
      .returning();
    res.status(201).json(GetUserResponse.parse(updated[0]));
    return;
  }

  const [user] = await db
    .insert(usersTable)
    .values(parsed.data)
    .returning();

  res.status(201).json(GetUserResponse.parse(user));
});

router.get("/users/:deviceId", async (req, res): Promise<void> => {
  const deviceId = Array.isArray(req.params.deviceId)
    ? req.params.deviceId[0]
    : req.params.deviceId;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.deviceId, deviceId))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(GetUserResponse.parse(user));
});

router.patch("/users/:deviceId", async (req, res): Promise<void> => {
  const deviceId = Array.isArray(req.params.deviceId)
    ? req.params.deviceId[0]
    : req.params.deviceId;

  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [user] = await db
    .update(usersTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(usersTable.deviceId, deviceId))
    .returning();

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(UpdateUserResponse.parse(user));
});

router.patch("/users/me/push-token", async (req, res): Promise<void> => {
  const requestingUserId = (req as any).user?.id as string | undefined;
  if (!requestingUserId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { pushToken } = req.body as { pushToken?: string };
  if (!pushToken || typeof pushToken !== "string") {
    res.status(400).json({ error: "pushToken is required" });
    return;
  }
  if (!pushToken.startsWith("ExponentPushToken[") && !pushToken.startsWith("ExpoPushToken[")) {
    res.status(400).json({ error: "Invalid push token format" });
    return;
  }

  await db
    .update(usersTable)
    .set({ pushToken, updatedAt: new Date() })
    .where(eq(usersTable.id, requestingUserId));

  res.json({ success: true });
});

export default router;
