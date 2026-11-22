import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { errors } from './errors.js';

/**
 * Private file storage abstraction.
 *
 * Files are written under a random storage key — the original filename is only
 * ever stored as metadata and never used to build a path (TRD §4.2). Swapping
 * this module for S3 is a one-file change: callers only know `storageKey`.
 */
const datasetDir = () => path.join(config.storageDir, 'datasets');

export function newStorageKey(extension) {
  return `${crypto.randomBytes(16).toString('hex')}.${extension}`;
}

/** Rejects traversal attempts even though keys are always generated server-side. */
function safePath(storageKey) {
  const base = datasetDir();
  const resolved = path.resolve(base, storageKey);
  if (!resolved.startsWith(path.resolve(base) + path.sep)) {
    throw errors.badRequest('Invalid storage reference.');
  }
  return resolved;
}

export async function put(storageKey, buffer) {
  await fs.mkdir(datasetDir(), { recursive: true });
  await fs.writeFile(safePath(storageKey), buffer, { mode: 0o600 });
}

export async function get(storageKey) {
  try {
    return await fs.readFile(safePath(storageKey));
  } catch {
    throw errors.notFound('The source file for this dataset is no longer available.');
  }
}

export async function remove(storageKey) {
  try {
    await fs.unlink(safePath(storageKey));
  } catch {
    /* deleting an already-missing file is not an error */
  }
}

/** Short-lived, dataset-scoped download token (TRD §8). */
export function signDownloadToken(datasetId, userId) {
  return jwt.sign({ ds: datasetId, uid: userId, scope: 'download' }, config.jwtSecret, {
    expiresIn: config.signedUrlTtlSeconds,
    issuer: 'datavista',
  });
}

export function verifyDownloadToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret, { issuer: 'datavista' });
  } catch {
    throw errors.forbidden('This download link has expired. Request a new one.');
  }
}
