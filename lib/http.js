// Small helpers shared by the routes: errors, input checks and key hashing.
import crypto from 'node:crypto';

// Throw this to send a specific status code and message to the client.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function parseId(value, label = 'ID') {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) {
    throw new HttpError(400, `${label} must be a positive whole number.`);
  }
  return id;
}

export function parseEnum(value, allowed, message) {
  if (typeof value !== 'string') throw new HttpError(400, message);
  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (!allowed.includes(normalized)) throw new HttpError(400, message);
  return normalized;
}

export function parseOptionalText(value, maxLength, label) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new HttpError(400, `${label} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new HttpError(400, `${label} must be ${maxLength.toLocaleString('en-CA')} characters or fewer.`);
  }
  return trimmed === '' ? null : trimmed;
}

export function requireObjectBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Send the data as a JSON object.');
  }
  return body;
}

// Edit keys: the reporter sees the key once; the database only stores its hash.
export function createEditKey() {
  return crypto.randomBytes(24).toString('base64url');
}

export function hashSecret(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest('hex');
}

// Compares two secrets without leaking how many characters matched.
export function secretsMatch(given, expectedHash) {
  const a = Buffer.from(hashSecret(given ?? ''), 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
