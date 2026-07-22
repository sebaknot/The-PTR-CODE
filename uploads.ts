import { Router, type IRouter } from "express";
import multer from "multer";
import { objectStorageClient } from "../lib/objectStorage";
import { randomUUID } from "crypto";

const authRouter: IRouter = Router();
const publicRouter: IRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are accepted"));
    }
  },
});

function getAppBaseUrl(): string {
  return process.env.APP_URL ?? "";
}

function parseObjectPath(fullPath: string): { bucketName: string; objectName: string } {
  const withoutScheme = fullPath.startsWith("gs://") ? fullPath.slice(5) : fullPath;
  const withoutLeadingSlash = withoutScheme.startsWith("/") ? withoutScheme.slice(1) : withoutScheme;
  const parts = withoutLeadingSlash.split("/");
  return { bucketName: parts[0], objectName: parts.slice(1).join("/") };
}

authRouter.post("/uploads/photo", upload.single("photo"), async (req, res): Promise<void> => {
  const requestingUserId = (req as any).user?.id as string | undefined;
  if (!requestingUserId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "No photo file provided" });
    return;
  }

  try {
    const privateObjectDir = process.env.PRIVATE_OBJECT_DIR;
    if (!privateObjectDir) {
      res.status(503).json({ error: "Storage not configured" });
      return;
    }

    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);

    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    await file.save(req.file.buffer, {
      contentType: req.file.mimetype,
      metadata: { cacheControl: "public, max-age=31536000, immutable" },
    });

    const baseUrl = getAppBaseUrl();
    if (!baseUrl) {
      res.status(503).json({ error: "Photo serving URL cannot be constructed: APP_URL not set" });
      return;
    }
    const servingUrl = `${baseUrl}/api/storage/objects/uploads/${objectId}`;

    res.json({ servingUrl, objectId });
  } catch (err: any) {
    if (err?.message?.includes("suspended")) {
      res.status(503).json({ error: "Storage service temporarily unavailable" });
    } else {
      res.status(500).json({ error: "Failed to store photo" });
    }
  }
});

publicRouter.get("/storage/objects/uploads/:objectId", async (req, res): Promise<void> => {
  const { objectId } = req.params;
  try {
    const privateObjectDir = process.env.PRIVATE_OBJECT_DIR;
    if (!privateObjectDir) {
      res.status(503).json({ error: "Storage not configured" });
      return;
    }
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);

    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    const [exists] = await file.exists();
    if (!exists) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const [metadata] = await file.getMetadata();
    const contentType = (metadata.contentType as string) || "image/jpeg";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

    file.createReadStream().pipe(res);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to serve photo" });
  }
});

export { authRouter as uploadsAuthRouter, publicRouter as uploadsPublicRouter };
export default authRouter;
