import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { eq, and, gt, lt } from "drizzle-orm";
import { db, usersTable, sessionsTable, otpCodesTable } from "@workspace/db";
import { createHash } from "node:crypto";

const router: IRouter = Router();

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const OTP_TTL_MS = 10 * 60 * 1000;

function generateToken(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function generateOtp(): string {
  return String(Math.floor(Math.random() * 9000) + 1000);
}

async function createSession(userId: string): Promise<string> {
  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessionsTable).values({ userId, token: tokenHash, expiresAt });
  return rawToken;
}

function userToPublic(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    deviceId: user.deviceId,
    email: user.email,
    phone: user.phone,
    firstName: user.firstName,
    lastName: user.lastName,
    name: user.name,
    role: user.role,
    isOnline: user.isOnline,
    totalDeliveries: user.totalDeliveries,
    rating: user.rating,
  };
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) return raw;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

async function sendPhoneOtp(phone: string, code: string): Promise<boolean> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromRaw = process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || !fromRaw) {
    console.log(`[DEV] OTP for ${phone}: ${code}`);
    return false;
  }
  const from = normalizePhone(fromRaw);
  const to = normalizePhone(phone);
  const twilio = await import("twilio");
  const client = twilio.default(accountSid, authToken);
  await client.messages.create({ body: `Your Porter code is: ${code}`, from, to });
  return true;
}

async function sendEmailOtp(email: string, code: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? "Porter <onboarding@resend.dev>";
  if (!apiKey) {
    console.log(`[DEV] OTP for ${email}: ${code}`);
    return false;
  }
  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);
  const result = await resend.emails.send({
    to: email, from: fromEmail,
    subject: "Your Porter verification code",
    text: `Your Porter code is: ${code}`,
    html: `<p>Your Porter verification code is: <strong>${code}</strong></p><p>This code expires in 10 minutes.</p>`,
  });
  if (result.error) {
    throw new Error(`Resend error: ${result.error.message}`);
  }
  return true;
}

async function verifyGoogleToken(idToken: string): Promise<{ sub: string; email: string; name?: string; given_name?: string; family_name?: string } | null> {
  try {
    const jwksClient = (await import("jwks-rsa")).default;
    const jwt = await import("jsonwebtoken");

    const client = jwksClient({ jwksUri: "https://www.googleapis.com/oauth2/v3/certs", cache: true, cacheMaxAge: 600_000 });

    const decoded = jwt.default.decode(idToken, { complete: true });
    if (!decoded || typeof decoded === "string" || !decoded.header.kid) return null;

    const key = await client.getSigningKey(decoded.header.kid);
    const publicKey = key.getPublicKey();

    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    const verifyOptions: import("jsonwebtoken").VerifyOptions = {
      algorithms: ["RS256"],
    };
    if (googleClientId) verifyOptions.audience = googleClientId;

    const payload = jwt.default.verify(idToken, publicKey, verifyOptions) as { sub: string; email: string; name?: string; given_name?: string; family_name?: string };
    return payload;
  } catch (err) {
    console.error("Google token verification failed:", err);
    return null;
  }
}

async function verifyGoogleAccessToken(accessToken: string): Promise<{ sub: string; email: string; name?: string; given_name?: string; family_name?: string } | null> {
  try {
    const res = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo?access_token=${encodeURIComponent(accessToken)}`);
    if (!res.ok) return null;
    const info = await res.json() as { sub?: string; email?: string; name?: string; given_name?: string; family_name?: string };
    if (!info.sub || !info.email) return null;
    return { sub: info.sub, email: info.email, name: info.name, given_name: info.given_name, family_name: info.family_name };
  } catch (err) {
    console.error("Google access token verification failed:", err);
    return null;
  }
}

async function verifyAppleToken(identityToken: string): Promise<{ sub: string; email?: string } | null> {
  try {
    const jwksClient = (await import("jwks-rsa")).default;
    const jwt = await import("jsonwebtoken");

    const client = jwksClient({ jwksUri: "https://appleid.apple.com/auth/keys", cache: true, cacheMaxAge: 600_000 });

    const decoded = jwt.default.decode(identityToken, { complete: true });
    if (!decoded || typeof decoded === "string" || !decoded.header.kid) return null;

    const key = await client.getSigningKey(decoded.header.kid);
    const publicKey = key.getPublicKey();

    const appleClientId = process.env.APPLE_CLIENT_ID;
    const verifyOptions: import("jsonwebtoken").VerifyOptions = {
      algorithms: ["RS256"],
      issuer: "https://appleid.apple.com",
    };
    if (appleClientId) verifyOptions.audience = appleClientId;

    const payload = jwt.default.verify(identityToken, publicKey, verifyOptions) as { sub: string; email?: string };
    return payload;
  } catch (err) {
    console.error("Apple token verification failed:", err);
    return null;
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const rawToken = authHeader.slice(7);
  const tokenHash = hashToken(rawToken);

  const [session] = await db
    .select()
    .from(sessionsTable)
    .where(and(eq(sessionsTable.token, tokenHash), gt(sessionsTable.expiresAt, new Date())));

  if (!session) {
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, session.userId));
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  (req as Request & { user: typeof user }).user = user;
  next();
}

async function resolveSessionUser(authHeader: string | undefined): Promise<{ user: typeof usersTable.$inferSelect; session: typeof sessionsTable.$inferSelect } | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const rawToken = authHeader.slice(7);
  const tokenHash = hashToken(rawToken);

  const [session] = await db
    .select()
    .from(sessionsTable)
    .where(and(eq(sessionsTable.token, tokenHash), gt(sessionsTable.expiresAt, new Date())));

  if (!session) return null;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, session.userId));
  if (!user) return null;

  return { user, session };
}

router.post("/auth/send-otp", async (req: Request, res: Response): Promise<void> => {
  let { target, type } = req.body ?? {};
  if (!target || !["phone", "email"].includes(type)) {
    res.status(400).json({ error: "target and type (phone|email) are required" });
    return;
  }
  if (type === "email") target = target.toLowerCase();

  await db.delete(otpCodesTable).where(
    and(eq(otpCodesTable.target, target), lt(otpCodesTable.expiresAt, new Date()))
  );

  const code = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  await db.insert(otpCodesTable).values({ target, type, code, expiresAt });

  let delivered = false;
  try {
    if (type === "phone") delivered = await sendPhoneOtp(target, code);
    else delivered = await sendEmailOtp(target, code);
  } catch (err) {
    console.error("OTP send error:", err);
    res.status(500).json({ error: "Failed to send verification code" });
    return;
  }

  const isDev = process.env.NODE_ENV !== "production";
  res.json({ ok: true, ...(isDev && !delivered ? { devCode: code } : {}) });
});

router.post("/auth/verify-otp", async (req: Request, res: Response): Promise<void> => {
  let { target, code, role } = req.body ?? {};
  if (!target || !code || !["sender", "courier"].includes(role)) {
    res.status(400).json({ error: "target, code, and role are required" });
    return;
  }
  if (typeof target === "string" && !target.startsWith("+")) target = target.toLowerCase();

  const [otpRecord] = await db
    .select()
    .from(otpCodesTable)
    .where(
      and(
        eq(otpCodesTable.target, target),
        eq(otpCodesTable.code, String(code)),
        eq(otpCodesTable.used, false),
        gt(otpCodesTable.expiresAt, new Date())
      )
    );

  if (!otpRecord) {
    res.status(400).json({ error: "Invalid or expired code" });
    return;
  }

  await db.update(otpCodesTable).set({ used: true }).where(eq(otpCodesTable.id, otpRecord.id));

  const isEmail = otpRecord.type === "email";
  const existing = isEmail
    ? await db.select().from(usersTable).where(eq(usersTable.email, target))
    : await db.select().from(usersTable).where(eq(usersTable.phone, target));

  let user = existing[0];
  const isNewUser = !user;

  if (!user) {
    const [inserted] = await db
      .insert(usersTable)
      .values({ email: isEmail ? target : undefined, phone: isEmail ? undefined : target, role, name: "" })
      .returning();
    user = inserted;
  } else if (user.role !== role) {
    const [updated] = await db.update(usersTable).set({ role }).where(eq(usersTable.id, user.id)).returning();
    user = updated;
  }

  const token = await createSession(user.id);
  res.json({ token, user: userToPublic(user), isNewUser });
});

router.post("/auth/complete-profile", async (req: Request, res: Response): Promise<void> => {
  const result = await resolveSessionUser(req.headers.authorization);
  if (!result) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { firstName, lastName } = req.body ?? {};
  if (!firstName?.trim() || !lastName?.trim()) {
    res.status(400).json({ error: "firstName and lastName are required" });
    return;
  }

  const name = `${firstName.trim()} ${lastName.trim()}`;
  const [updated] = await db
    .update(usersTable)
    .set({ firstName: firstName.trim(), lastName: lastName.trim(), name })
    .where(eq(usersTable.id, result.user.id))
    .returning();

  res.json({ user: userToPublic(updated) });
});

router.post("/auth/google", async (req: Request, res: Response): Promise<void> => {
  const { idToken, accessToken, role } = req.body ?? {};
  if ((!idToken && !accessToken) || !["sender", "courier"].includes(role)) {
    res.status(400).json({ error: "idToken or accessToken, and role are required" });
    return;
  }

  let payload: { sub: string; email: string; name?: string; given_name?: string; family_name?: string } | null = null;
  if (idToken) {
    payload = await verifyGoogleToken(idToken);
  } else {
    payload = await verifyGoogleAccessToken(accessToken);
  }
  if (!payload) {
    res.status(401).json({ error: "Invalid Google token" });
    return;
  }

  let [user] = await db.select().from(usersTable).where(eq(usersTable.googleId, payload.sub));

  if (!user && payload.email) {
    const [byEmail] = await db.select().from(usersTable).where(eq(usersTable.email, payload.email));
    user = byEmail;
  }

  let isNewUser = false;
  if (!user) {
    isNewUser = true;
    const firstName = payload.given_name ?? payload.name?.split(" ")[0] ?? "";
    const lastName = payload.family_name ?? payload.name?.split(" ").slice(1).join(" ") ?? "";
    const name = payload.name ?? `${firstName} ${lastName}`.trim();
    const [inserted] = await db
      .insert(usersTable)
      .values({ googleId: payload.sub, email: payload.email, firstName, lastName, name, role })
      .returning();
    user = inserted;
  } else {
    const updates: Partial<typeof usersTable.$inferInsert> = { googleId: payload.sub };
    if (!user.name && payload.name) {
      updates.name = payload.name;
      updates.firstName = payload.given_name;
      updates.lastName = payload.family_name;
    }
    const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, user.id)).returning();
    user = updated;
  }

  const token = await createSession(user.id);
  res.json({ token, user: userToPublic(user), isNewUser });
});

router.post("/auth/apple", async (req: Request, res: Response): Promise<void> => {
  const { identityToken, role, email: emailFromApple, fullName } = req.body ?? {};
  if (!identityToken || !["sender", "courier"].includes(role)) {
    res.status(400).json({ error: "identityToken and role are required" });
    return;
  }

  const payload = await verifyAppleToken(identityToken);
  if (!payload) {
    res.status(401).json({ error: "Invalid Apple identity token" });
    return;
  }

  const appleId = payload.sub;
  const appleEmail = emailFromApple ?? payload.email;

  let [user] = await db.select().from(usersTable).where(eq(usersTable.appleId, appleId));

  if (!user && appleEmail) {
    const [byEmail] = await db.select().from(usersTable).where(eq(usersTable.email, appleEmail));
    user = byEmail;
  }

  let isNewUser = false;
  if (!user) {
    isNewUser = true;
    const firstName = fullName?.givenName ?? "";
    const lastName = fullName?.familyName ?? "";
    const name = [firstName, lastName].filter(Boolean).join(" ");
    const [inserted] = await db
      .insert(usersTable)
      .values({ appleId, email: appleEmail, firstName, lastName, name, role })
      .returning();
    user = inserted;
  } else {
    const [updated] = await db.update(usersTable).set({ appleId }).where(eq(usersTable.id, user.id)).returning();
    user = updated;
  }

  const token = await createSession(user.id);
  res.json({ token, user: userToPublic(user), isNewUser });
});


router.get("/auth/me", async (req: Request, res: Response): Promise<void> => {
  const result = await resolveSessionUser(req.headers.authorization);
  if (!result) { res.status(401).json({ error: "Unauthorized" }); return; }
  res.json(userToPublic(result.user));
});

router.post("/auth/logout", async (req: Request, res: Response): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(400).json({ error: "No token provided" });
    return;
  }
  const rawToken = authHeader.slice(7);
  const tokenHash = hashToken(rawToken);
  await db.delete(sessionsTable).where(eq(sessionsTable.token, tokenHash));
  res.json({ ok: true });
});

export { router as authRouter };
