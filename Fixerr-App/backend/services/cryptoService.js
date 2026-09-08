// services/cryptoService.js - Sensitive Data Encryption/Decryption Helper
const crypto = require('crypto');
const env = require('../config/env');

const ALGORITHM = 'aes-256-gcm';
// Ensure key is exactly 32 bytes
const KEY = crypto.createHash('sha256').update(String(env.ENCRYPTION_KEY)).digest();

function encrypt(text) {
  if (!text || typeof text !== 'string') return text;
  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `enc:${iv.toString('hex')}:${authTag}:${encrypted}`;
  } catch (err) {
    console.error('Encryption error:', err.message);
    return text;
  }
}

function decrypt(text) {
  if (!text || typeof text !== 'string' || !text.startsWith('enc:')) return text;
  try {
    const parts = text.split(':');
    if (parts.length !== 4) return text;
    const iv = Buffer.from(parts[1], 'hex');
    const authTag = Buffer.from(parts[2], 'hex');
    const encryptedText = parts[3];
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('Decryption error:', err.message);
    return text;
  }
}

function maskSensitive(text) {
  if (!text || typeof text !== 'string') return text;
  const raw = decrypt(text);
  if (raw.length <= 4) return '****';
  return '*'.repeat(raw.length - 4) + raw.slice(-4);
}

module.exports = { encrypt, decrypt, maskSensitive };
