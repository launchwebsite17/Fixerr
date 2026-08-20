function sanitizeFileName(name) {
  const cleaned = String(name || "document")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "document";
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
};
