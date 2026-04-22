import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'

const firebaseConfig = {
  apiKey: 'AIzaSyD3ewf8GD0P-p_mnKDwmyXfIt5f5aTbE-8',
  authDomain: 'sightseeing-40ce2.firebaseapp.com',
  projectId: 'sightseeing-40ce2',
  storageBucket: 'sightseeing-40ce2.firebasestorage.app',
  messagingSenderId: '338165023155',
  appId: '1:338165023155:web:984b83da2cba15c5e38bc6',
}

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const googleProvider = new GoogleAuthProvider()
