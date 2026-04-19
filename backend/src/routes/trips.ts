import { Router, Request, Response } from 'express';
import { prisma } from '../server';
import { InternalEventBus } from '../events/eventBus';

const router = Router();

// POST /api/trips
// Generate a new basic draft trip
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    // In actual implementation, `user_id` should come from JWT token authentication middleware.
    // For now we mock or take it from the root body.
    const { user_id, destination_city, start_date, end_date, budget_total, raw_prompt } = req.body;

    if (!user_id || !destination_city || !start_date || !end_date || budget_total === undefined) {
      res.status(400).json({ success: false, error: 'Missing required configuration fields.' });
      return;
    }

    // Insert the primary trip
    const newTrip = await prisma.trip.create({
      data: {
        user_id,
        destination_city,
        start_date: new Date(start_date),
        end_date: new Date(end_date),
        budget_total: parseInt(budget_total),
        raw_prompt: raw_prompt || null,
        status: 'draft',
      }
    });

    InternalEventBus.publish('trip.created', { trip_id: newTrip.trip_id, user_id });

    res.status(201).json({
      success: true,
      message: 'Trip initialized successfully as draft.',
      data: newTrip,
    });
  } catch (error) {
    console.error('Error creating trip:', error);
    res.status(500).json({ success: false, error: 'Internal server error while creating trip' });
  }
});

export default router;
