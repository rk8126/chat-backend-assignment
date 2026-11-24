import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { Env } from '../config';

export function createFirestore(env: Env): Firestore {
  if (getApps().length === 0) initializeApp({ projectId: env.FIREBASE_PROJECT_ID });
  const db = getFirestore();
  db.settings({ ignoreUndefinedProperties: true });
  return db;
}
