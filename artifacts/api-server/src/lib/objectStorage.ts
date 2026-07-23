import { Storage, File } from "@google-cloud/storage";
import { Readable } from "stream";

function createStorageClient(): Storage {
  const keyJson = process.env.GOOGLE_CLOUD_KEY_JSON;
  if (keyJson) {
    const credentials = JSON.parse(keyJson);
    return new Storage({ credentials, projectId: credentials.project_id });
  }
  // Falls back to Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS)
  return new Storage();
}

export const objectStorageClient = createStorageClient();

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a GCS bucket and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir;
  }

  async downloadObject(file: File): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;
    const headers: Record<string, string> = {
      "Content-Type": (metadata.contentType as string) || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
    };
    if (metadata.size) {
      headers["Content-Length"] = String(metadata.size);
    }
    return new Response(webStream, { headers });
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }
}

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }
  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");
  return { bucketName, objectName };
}
