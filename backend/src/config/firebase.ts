import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';

// Check if firebase-service-account.json exists in root
const serviceAccountPath = path.join(__dirname, '../../firebase-service-account.json');

try {
  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('Firebase Admin initialized successfully using service account JSON.');
  } else {
    console.warn(`FIREBASE SERVICE ACCOUNT NOT FOUND at ${serviceAccountPath}. Firebase Auth will not work.`);
  }
} catch (e) {
  console.error('Failed to initialize Firebase Admin:', e);
}

export const auth = admin.apps.length ? admin.auth() : null;
