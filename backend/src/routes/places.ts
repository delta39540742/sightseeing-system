import { Router, Request, Response } from 'express';
import { prisma } from '../server';
import { InternalEventBus } from '../events/eventBus';

const router = Router();

// GET /api/places
// Get a list of places with pagination and basic filtering
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const indoor_outdoor = req.query.indoor_outdoor as string;
    const is_landmark = req.query.is_landmark === 'true';

    // Build Prisma filter
    const whereClause: any = {};
    if (indoor_outdoor) whereClause.indoor_outdoor = indoor_outdoor;
    if (req.query.is_landmark !== undefined) whereClause.is_landmark = is_landmark;

    const [places, total] = await Promise.all([
      prisma.place.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: { popularity_score: 'desc' },
      }),
      prisma.place.count({ where: whereClause })
    ]);

    InternalEventBus.publish('places.listed', { page, limit, totalFound: total });

    res.status(200).json({ 
      success: true, 
      data: places,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching places:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/places/:id
// Get detailed place by ID
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    // Handling id conversion correctly for BigInt. 
    // Prisma requires BigInt input matching the autoincrement ID
    let placeId: bigint;
    try {
      placeId = BigInt(req.params.id as string);
    } catch {
      res.status(400).json({ success: false, error: 'Invalid ID format' });
      return;
    }

    const place = await prisma.place.findUnique({ 
      where: { place_id: placeId } 
    });
    
    if (!place) {
      res.status(404).json({ success: false, error: 'Place not found' });
      return;
    }

    res.status(200).json({ success: true, data: place });
  } catch (error) {
    console.error('Error fetching place details:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
