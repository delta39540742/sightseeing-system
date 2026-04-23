import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // Deploy platforms store the key with literal \n — restore real newlines
  const privateKey  = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    console.warn('[Firebase] Missing env vars (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY). Auth disabled.');
  } else {
    try {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          privateKey,
          clientEmail,
        }),
      });
      console.log('[Firebase] Admin SDK initialized.');
    } catch (e) {
      console.error('[Firebase] Failed to initialize Admin SDK:', e);
    }
  }
}

export const auth = admin.apps.length ? admin.auth() : null;
