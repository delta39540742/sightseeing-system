/**
 * Tạo Firebase ID token thật để test API login.
 *
 * Cách dùng:
 *   npx ts-node scripts/get-test-token.ts <WEB_API_KEY>
 *
 * Lấy WEB_API_KEY: Firebase Console → Project Settings → General → Web API Key
 */

import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';

const WEB_API_KEY = process.argv[2];
if (!WEB_API_KEY) {
  console.error('Thiếu Web API Key!\nDùng: npx ts-node scripts/get-test-token.ts <WEB_API_KEY>');
  process.exit(1);
}

const serviceAccountPath = path.join(__dirname, '../firebase-service-account.json');
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

async function main() {
  const TEST_UID = 'test-user-local';

  // Bước 1: Tạo custom token bằng Admin SDK
  const customToken = await admin.auth().createCustomToken(TEST_UID);
  console.log('\n[1] Custom Token (dùng nội bộ, không gửi API):\n', customToken);

  // Bước 2: Đổi custom token → ID token qua Firebase REST API
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${WEB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );

  const data = await res.json() as any;

  if (data.error) {
    console.error('\n[Lỗi]', data.error.message);
    process.exit(1);
  }

  const idToken: string = data.idToken;
  console.log('\n[2] ID Token (dùng để gọi API):\n', idToken);
  console.log('\n--- Lệnh curl để test login ---');
  console.log(`curl -X POST http://localhost:3000/api/auth/login \\`);
  console.log(`  -H "Authorization: Bearer ${idToken}"`);
  console.log('');
}

main().catch(console.error);
