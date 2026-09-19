const fs = require("fs");
const path = require("path");
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const env = require("../config/env");

// Local development retains the existing frontend/pro_assets behavior. Hosted environments
// use private Cloudflare R2 objects and persist only stable object keys in PostgreSQL.
const PRO_ASSETS_ROOT = path.join(__dirname, "..", "..", "frontend", "pro_assets");
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const PRESIGNED_URL_TTL_SECONDS = 15 * 60;

class ProAssetError extends Error {
  constructor(message, statusCode = 400, publicMessage = message) {
    super(message);
    this.name = "ProAssetError";
    this.statusCode = statusCode;
    this.publicMessage = publicMessage;
  }
}

function isLocalAssetStorage() {
  if (String(process.env.RENDER || "").toLowerCase() === "true") return false;
  try {
    const host = new URL(env.APP_BASE_URL).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch (_) {
    return false;
  }
}

function assertR2Configured() {
  if (
    !env.R2_ACCOUNT_ID ||
    !env.R2_ACCESS_KEY_ID ||
    !env.R2_SECRET_ACCESS_KEY ||
    !env.R2_BUCKET_NAME
  ) {
    throw new ProAssetError(
      "Cloudflare R2 environment variables are incomplete.",
      503,
      "Secure file storage is temporarily unavailable. Please try again later.",
    );
  }
}

let r2Client = null;
function getR2Client() {
  assertR2Configured();
  if (!r2Client) {
    r2Client = new S3Client({
      region: "auto",
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return r2Client;
}

function slugToken(value, fallback) {
  const cleaned = String(value || "").replace(/[^a-zA-Z0-9]+/g, "");
  return cleaned || fallback || "x";
}

function extFromMime(mime) {
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpeg";
}

function detectMime(buffer) {
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString("ascii") === "%PDF")
    return "application/pdf";
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer.subarray(1, 4).toString("ascii") === "PNG" &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  )
    return "image/png";
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  )
    return "image/jpeg";
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  return null;
}

function decodeAndValidateUpload(file, isPhoto) {
  if (!file || typeof file.data !== "string" || !file.data) return null;
  const base64 = file.data.replace(/\s+/g, "");
  if (
    !base64 ||
    base64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
  ) {
    throw new ProAssetError("The uploaded file data is invalid.");
  }

  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) throw new ProAssetError("The uploaded file is empty.");
  if (buffer.length > MAX_UPLOAD_BYTES)
    throw new ProAssetError("Each uploaded file must be under 5MB.");

  const mime = detectMime(buffer);
  if (!mime)
    throw new ProAssetError(
      "Only JPG, PNG, WebP or PDF files are accepted.",
    );
  if (isPhoto && !mime.startsWith("image/"))
    throw new ProAssetError("The profile photo must be an image file.");
  return { buffer, mime };
}

function buildStoredAsset({ cpUniqueId, firstName, lastName, label, mime }) {
  const ext = extFromMime(mime);
  const parts = label
    ? [
        cpUniqueId,
        slugToken(firstName, "First"),
        slugToken(lastName, "Last"),
        slugToken(label),
      ]
    : [cpUniqueId, "ProfilePhoto"];
  const fileName = parts.join("_") + "." + ext;
  return {
    fileName,
    objectKey: `pro_assets/${cpUniqueId}/${fileName}`,
  };
}

// Saves the existing base64 upload payload either to the local development folder or to
// private R2 storage. The DB receives a local web path in local development and an object key
// in hosted environments; credentials and full R2 URLs are never persisted.
async function saveProUpload({ cpUniqueId, firstName, lastName, label, file }) {
  if (!file || !file.data) return null;
  if (!cpUniqueId)
    throw new ProAssetError(
      "The professional account is missing its Fixerr ID.",
      400,
      "Could not identify the professional account. Please contact support.",
    );

  const upload = decodeAndValidateUpload(file, !label);
  const asset = buildStoredAsset({
    cpUniqueId,
    firstName,
    lastName,
    label,
    mime: upload.mime,
  });

  if (isLocalAssetStorage()) {
    const dir = path.join(PRO_ASSETS_ROOT, cpUniqueId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, asset.fileName), upload.buffer);
    return `/${asset.objectKey}`;
  }

  try {
    await getR2Client().send(
      new PutObjectCommand({
        Bucket: env.R2_BUCKET_NAME,
        Key: asset.objectKey,
        Body: upload.buffer,
        ContentType: upload.mime,
        ContentDisposition: `inline; filename="${asset.fileName}"`,
      }),
    );
    return asset.objectKey;
  } catch (error) {
    if (error instanceof ProAssetError) throw error;
    console.error("[R2 upload]", error.message);
    throw new ProAssetError(
      "Cloudflare R2 upload failed.",
      503,
      "File upload failed. Please try again.",
    );
  }
}

function storedAssetKey(storedValue) {
  const value = String(storedValue || "").trim();
  if (!value || value.startsWith("data:") || /^https?:\/\//i.test(value))
    return null;
  const key = value.replace(/^\/+/, "");
  return key.startsWith("pro_assets/") ? key : null;
}

async function resolveProAssetUrl(storedValue) {
  if (!storedValue) return null;
  const key = storedAssetKey(storedValue);
  if (!key) return storedValue;
  if (isLocalAssetStorage()) return `/${key}`;
  try {
    return await getSignedUrl(
      getR2Client(),
      new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }),
      { expiresIn: PRESIGNED_URL_TTL_SECONDS },
    );
  } catch (error) {
    if (error instanceof ProAssetError) throw error;
    console.error("[R2 presign]", error.message);
    throw new ProAssetError(
      "Could not create a secure asset link.",
      503,
      "Uploaded files are temporarily unavailable. Please try again.",
    );
  }
}

// Used only as compensating cleanup when an upload succeeds but the application INSERT fails.
// It does not alter the existing admin delete/replace behavior.
async function deleteProAsset(storedValue) {
  const key = storedAssetKey(storedValue);
  if (!key) return;
  if (isLocalAssetStorage()) {
    const relative = key.slice("pro_assets/".length);
    const fullPath = path.resolve(PRO_ASSETS_ROOT, relative);
    const rootWithSep = path.resolve(PRO_ASSETS_ROOT) + path.sep;
    if (fullPath.startsWith(rootWithSep))
      await fs.promises.unlink(fullPath).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    return;
  }
  await getR2Client().send(
    new DeleteObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }),
  );
}

async function rollbackProAssets(storedValues) {
  await Promise.allSettled(
    (storedValues || []).filter(Boolean).map((value) => deleteProAsset(value)),
  );
}

module.exports = {
  saveProUpload,
  resolveProAssetUrl,
  rollbackProAssets,
  isLocalAssetStorage,
  ProAssetError,
};
