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
  // POST /api/places — tạo địa điểm tùy chỉnh từ tên + tọa độ (dùng cho Google Maps URL không có trong DB)
  fastify.post('/', async (request, reply) => {
    try {
      const body = request.body as { name?: string; lat?: number; lng?: number; description?: string };
      const { name, lat, lng, description } = body ?? {};
      if (!name || lat == null || lng == null || isNaN(lat) || isNaN(lng)) {
        return reply.status(400).send({ success: false, error: 'name, lat, lng are required' });
      }

      const rows = await prisma.$queryRaw<any[]>`
        INSERT INTO place (name, description, geom, price_type, avg_visit_duration_min, indoor_outdoor)
        VALUES (
          ${name},
          ${description ?? null},
          ST_MakePoint(${lng}, ${lat})::geography,
          'unknown',
          60,
          'outdoor'
        )
        RETURNING place_id,
                  name,
                  description,
                  ST_Y(geom::geometry) AS lat,
                  ST_X(geom::geometry) AS lng,
                  price_type,
                  avg_visit_duration_min,
                  indoor_outdoor,
                  min_price,
                  max_price,
                  popularity_score,
                  address,
                  is_landmark
      `;

      return reply.status(201).send({ success: true, data: serializePlace(rows[0]) });
    } catch (error) {
      request.log.error({ err: error }, 'Error creating custom place');
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  // GET /api/places/resolve-url?url= — follow redirect của short Google Maps URL → trả finalUrl
  fastify.get('/resolve-url', async (request, reply) => {
    const { url } = request.query as { url?: string };
    if (!url || !/google\.com\/maps|maps\.app\.goo\.gl|goo\.gl\/maps/.test(url)) {
      return reply.status(400).send({ success: false, error: 'url must be a Google Maps link' });
    }
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(5000),
      });
      return reply.send({ success: true, finalUrl: response.url });
    } catch (error) {
      request.log.error({ err: error }, 'Error resolving short URL');
      return reply.status(502).send({ success: false, error: 'Could not resolve URL' });
    }
  });

  // GET /api/places/nearby?lat=&lng=&radius=500
  fastify.get('/nearby', async (request, reply) => {
    try {
      const query = request.query as Record<string, string>;
      const lat = parseFloat(query['lat'] ?? '');
      const lng = parseFloat(query['lng'] ?? '');
      const radius = parseFloat(query['radius'] ?? '') || 500;

      if (isNaN(lat) || isNaN(lng)) {
        return reply.status(400).send({ success: false, error: 'lat and lng are required' });
      }

      const rows = await prisma.$queryRaw<any[]>`
        SELECT p.place_id, p.name, p.description, p.lat, p.lng,
               p.avg_visit_duration_min, p.indoor_outdoor, p.is_landmark,
               p.min_price, p.max_price, p.price_type, p.address,
               p.popularity_score,
               ST_Distance(p.geom, ST_MakePoint(${lng}, ${lat})::geography) AS distance_m
        FROM place p
        WHERE ST_DWithin(p.geom, ST_MakePoint(${lng}, ${lat})::geography, ${radius})
        ORDER BY distance_m
        LIMIT 5
      `;

      return reply.status(200).send({
        success: true,
        data: rows.map((r) => ({ ...serializePlace(r), distanceM: Number(r.distance_m) })),
      });
    } catch (error) {
      request.log.error({ err: error }, 'Error fetching nearby places');
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  // GET /api/places
  fastify.get('/', async (request, reply) => {
    try {
      const query = request.query as Record<string, string>;
      const page = parseInt(query['page'] ?? '') || 1;
      const q = query['q']?.trim() || '';
      const rawLimit = parseInt(query['limit'] ?? '') || 20;
      const limit = q ? Math.min(rawLimit, 10) : rawLimit;
      const skip = (page - 1) * limit;

      const indoor_outdoor = query['indoor_outdoor'];
      const is_landmark = query['is_landmark'] === 'true';
      const ids = query['ids']
        ? query['ids'].split(',').map((s) => BigInt(s.trim())).filter(Boolean)
        : null;

      // Khi có từ khóa tìm kiếm: dùng raw SQL với unaccent + pg_trgm để tìm gần đúng,
      // bỏ dấu tiếng Việt và hỗ trợ typo nhẹ.
      if (q) {
        const rows = await prisma.$queryRaw<any[]>`
          SELECT p.place_id, p.name, p.description, p.lat, p.lng,
                 p.avg_visit_duration_min, p.indoor_outdoor, p.is_landmark,
                 p.min_price, p.max_price, p.price_type, p.address,
                 p.popularity_score
          FROM place p
          WHERE
            unaccent(lower(p.name)) LIKE '%' || unaccent(lower(${q})) || '%'
            OR word_similarity(unaccent(lower(${q})), unaccent(lower(p.name))) > 0.25
          ORDER BY
            word_similarity(unaccent(lower(${q})), unaccent(lower(p.name))) DESC,
            p.popularity_score DESC
          LIMIT ${limit} OFFSET ${skip}
        `;

        InternalEventBus.publish('places.listed', { page, limit, totalFound: rows.length });

        return reply.status(200).send({
          success: true,
          data: rows.map(serializePlace),
          meta: { total: rows.length, page, limit, totalPages: 1 },
        });
      }

      const whereClause: any = {};
      if (indoor_outdoor) whereClause.indoor_outdoor = indoor_outdoor;
      if (query['is_landmark'] !== undefined) whereClause.is_landmark = is_landmark;
      if (ids && ids.length > 0) whereClause.place_id = { in: ids };

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
