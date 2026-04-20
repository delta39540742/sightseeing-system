import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import placeRoutes from './routes/place';
import tripsRouter from './routes/trips';
import internalEventsRouter from './routes/internalEvents';
import authRouter from './routes/auth';

// Initialize env
dotenv.config();

// Fix BigInt JSON serialization globally for Express to return BigInt as String properly
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

const app = express();
const port = process.env.PORT || 3000;

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString });
export const prisma = new PrismaClient({ adapter });


// Middlewares
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRouter);
app.use('/api/places', placeRoutes);
app.use('/api/trips', tripsRouter);
app.use('/api/internal/events', internalEventsRouter);

// Basic health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'TDTT Backend is running' });
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
