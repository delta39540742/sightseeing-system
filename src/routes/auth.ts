import { Router } from 'express';
import { prisma } from '../server';
import { verifyToken, AuthRequest } from '../middlewares/authMiddleware';

const router = Router();

// POST /api/auth/login
// Listen after client successfully authenticated with Firebase
// Client sends Firebase ID Token, Backend checks/creates User in Postgres
router.post('/login', verifyToken, async (req: AuthRequest, res) => {
  try {
    const { uid, email, name } = req.user!;
    
    // Check if user exists in DB
    let user = await prisma.app_user.findUnique({
      where: { firebase_uid: uid }
    });

    // If not exists, create new app_user
    if (!user) {
      user = await prisma.app_user.create({
        data: {
          firebase_uid: uid,
          email: email || `${uid}@unknown.com`,
          display_name: name || 'Người dùng mới',
        }
      });
      console.log(`[Auth] Created new DB user for UID: ${uid}`);
    } else {
      console.log(`[Auth] Existing user logged in UID: ${uid}`);
    }

    res.status(200).json({ 
      success: true, 
      message: 'Login successful',
      data: user 
    });
  } catch (error) {
    console.error('Error during login mapping:', error);
    res.status(500).json({ success: false, error: 'Internal server error while linking account' });
  }
});

export default router;
