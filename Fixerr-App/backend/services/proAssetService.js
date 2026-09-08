const fs = require("fs");
const path = require("path");

// frontend/pro_assets — served statically by server.js (express.static over ../frontend),
// so anything written here is reachable at /pro_assets/<...> in the browser.
const PRO_ASSETS_ROOT = path.join(__dirname, "..", "..", "frontend", "pro_assets");

function sanitizeFileName(name) {
  const cleaned = String(name || "document")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "document";
}

// Strips a string down to a filename-safe token (letters/digits only) for building the
// FixerrUniqueID_FirstName_LastName_DocType naming convention.
function slugToken(s, fallback) {
  const cleaned = String(s || "").replace(/[^a-zA-Z0-9]+/g, "");
  return cleaned || fallback || "x";
}

function extFromUpload(type, name) {
  const mime = inferMime(type, name);
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpeg";
}

// Writes a base64-encoded upload ({name, type, data}) to frontend/pro_assets/<cpUniqueId>/,
// named "<cpUniqueId>_<FirstName>_<LastName>_<label>.<ext>" (label omitted for the profile
// photo, which is just "<cpUniqueId>_ProfilePhoto.<ext>"). Returns the web-relative path to
// store in the DB (photo_url / doc1_url / doc2_url), or null if there's nothing to save.
function saveProUpload({ cpUniqueId, firstName, lastName, label, file }) {
  if (!file || !file.data || !cpUniqueId) return null;
  const dir = path.join(PRO_ASSETS_ROOT, cpUniqueId);
  fs.mkdirSync(dir, { recursive: true });

  const ext = extFromUpload(file.type, file.name);
  const parts = label
    ? [cpUniqueId, slugToken(firstName, "First"), slugToken(lastName, "Last"), slugToken(label)]
    : [cpUniqueId, "ProfilePhoto"];
  const fileName = parts.join("_") + "." + ext;

  fs.writeFileSync(path.join(dir, fileName), Buffer.from(file.data, "base64"));
  return `/pro_assets/${cpUniqueId}/${fileName}`;
}

function inferMime(type, name) {
  if (type) return type;
  const lower = String(name || "").toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

function dataUrlFromUpload(file) {
  if (!file || !file.data) return null;
  return `data:${inferMime(file.type, file.name)};base64,${file.data}`;
}

function normalizeUploadedDocuments(documents) {
  return (Array.isArray(documents) ? documents : []).map((doc, index) => ({
    id: `doc_${Date.now()}_${index}`,
    name: sanitizeFileName(doc.name || `document_${index + 1}`),
    size: Number(doc.size || 0),
    type: inferMime(doc.type, doc.name),
    uploaded: new Date().toISOString(),
    data_url: dataUrlFromUpload(doc),
  }));
}

function normalizeUploadedPhoto(photo) {
  if (!photo) return null;
  return {
    name: sanitizeFileName(photo.name || "profile_photo"),
    type: inferMime(photo.type, photo.name),
    size: Number(photo.size || 0),
    data_url: dataUrlFromUpload(photo),
  };
}

module.exports = {
  normalizeUploadedDocuments,
  normalizeUploadedPhoto,
  saveProUpload,
};
