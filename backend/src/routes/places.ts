import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { InternalEventBus } from '../events/eventBus';

// Trả về place với place_id dạng number (thay vì string từ BigInt.toJSON) để
// FE không cần xử lý hai dạng khác nhau giữa /api/places và /api/trips.
function serializePlace(p: any) {
  if (!p) return p;
  return { ...p, place_id: Number(p.place_id) };
}

export async function placesPlugin(fastify: FastifyInstance): Promise<void> {
  // GET /api/places
  fastify.get('/', async (request, reply) => {
    try {
      const query = request.query as Record<string, string>;
      const page = parseInt(query['page'] ?? '') || 1;
      const limit = parseInt(query['limit'] ?? '') || 20;
      const skip = (page - 1) * limit;

      const indoor_outdoor = query['indoor_outdoor'];
      const is_landmark = query['is_landmark'] === 'true';

      const whereClause: any = {};
      if (indoor_outdoor) whereClause.indoor_outdoor = indoor_outdoor;
      if (query['is_landmark'] !== undefined) whereClause.is_landmark = is_landmark;

      const [places, total] = await Promise.all([
        prisma.place.findMany({
          where: whereClause,
          skip,
          take: limit,
          orderBy: { popularity_score: 'desc' },
        }),
        prisma.place.count({ where: whereClause }),
      ]);

      InternalEventBus.publish('places.listed', { page, limit, totalFound: total });

      return reply.status(200).send({
        success: true,
        data: places.map(serializePlace),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      request.log.error({ err: error }, 'Error fetching places');
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  // GET /api/places/:id
  fastify.get('/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      let placeId: bigint;
      try {
        placeId = BigInt(id);
      } catch {
        return reply.status(400).send({ success: false, error: 'Invalid ID format' });
      }

      const place = await prisma.place.findUnique({
        where: { place_id: placeId },
      });

      if (!place) {
        return reply.status(404).send({ success: false, error: 'Place not found' });
      }

      return reply.status(200).send({ success: true, data: serializePlace(place) });
    } catch (error) {
      request.log.error({ err: error }, 'Error fetching place details');
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });
}
