import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { InternalEventBus } from '../events/eventBus';
import { embedText, vectorToSqlLiteral } from '../services/embeddingService';

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
      
      // Hàm dọn dẹp ký tự wildcard tránh lỗi truy vấn LIKE và giới hạn độ dài (Anti-DoS)
      const sanitizeAndLimit = (str: string) => str.substring(0, 100).replace(/[%_\\]/g, '\\$&');
      const q = sanitizeAndLimit(query['q']?.trim() || '');
      const rawLimit = parseInt(query['limit'] ?? '') || 20;
      const limit = q ? Math.min(rawLimit, 10) : rawLimit;
      const skip = (page - 1) * limit;
      const city = sanitizeAndLimit(query['city']?.trim() || '');

      // Nếu từ khóa q quá ngắn (1 ký tự), trả về mảng rỗng để tránh rác và đỡ tải DB
      if (q.length === 1 && !city) {
        return response.send({
          data: [],
          total: 0,
          page,
          limit,
        });
      }

      const indoor_outdoor = query['indoor_outdoor'];
      const is_landmark = query['is_landmark'] === 'true';
      const ids = query['ids']
        ? query['ids'].split(',').map((s) => BigInt(s.trim())).filter(Boolean)
        : null;

      if (q) {
        let rows: any[] = [];
        
        let vectorSql = '';
        let hasSemantic = false;
        
        // Nếu query có từ 3 chữ trở lên, có khả năng là truy vấn ngữ nghĩa
        if (q.trim().split(/\s+/).length >= 2) {
          try {
            const vec = await embedText(q);
            if (vec.some(v => v !== 0)) {
              vectorSql = vectorToSqlLiteral(vec);
              hasSemantic = true;
            }
          } catch (err) {
            request.log.warn({ err }, 'Embedding failed in search');
          }
        }
        
        const semanticScoreField = hasSemantic
          ? Prisma.sql`(1 - (p.description_embedding <=> ${Prisma.raw(`'${vectorSql}'`)}::vector)) * 1.5`
          : Prisma.sql`0.0`;

        const min_price = query['min_price'] ? Number(query['min_price']) : undefined;
        const max_price = query['max_price'] ? Number(query['max_price']) : undefined;

        const indoorOutdoorCondition = indoor_outdoor 
          ? Prisma.sql`AND p.indoor_outdoor = ${indoor_outdoor}` 
          : Prisma.empty;
        const isLandmarkCondition = query['is_landmark'] !== undefined
          ? Prisma.sql`AND p.is_landmark = ${is_landmark}`
          : Prisma.empty;
        const idsCondition = ids && ids.length > 0
          ? Prisma.sql`AND p.place_id IN (${Prisma.join(ids)})`
          : Prisma.empty;
        const minPriceCondition = min_price !== undefined && !isNaN(min_price)
          ? Prisma.sql`AND p.min_price >= ${min_price}`
          : Prisma.empty;
        const maxPriceCondition = max_price !== undefined && !isNaN(max_price)
          ? Prisma.sql`AND p.max_price <= ${max_price}`
          : Prisma.empty;

        if (city) {
          // Khi có bộ lọc thành phố, CHỈ LỌC TRÊN cột province hoặc address (tránh rò rỉ rác từ description/name)
          rows = await prisma.$queryRaw<any[]>`
            SELECT p.*,
                   GREATEST(
                     word_similarity(unaccent(lower(${q})), unaccent(lower(p.name))),
                     word_similarity(unaccent(lower(p.name)), unaccent(lower(${q}))),
                     CASE WHEN unaccent(lower(p.province)) LIKE '%' || unaccent(lower(${q})) || '%' THEN 2.0 ELSE 0.0 END,
                     CASE WHEN unaccent(lower(p.address)) LIKE '%' || unaccent(lower(${q})) || '%' THEN 1.5 ELSE 0.0 END,
                     ${semanticScoreField}
                   ) as final_score
            FROM place p
            WHERE (
              ${q} = '' OR
              unaccent(lower(p.province)) LIKE '%' || unaccent(lower(${q})) || '%'
              OR unaccent(lower(p.name)) LIKE '%' || unaccent(lower(${q})) || '%'
              OR unaccent(lower(p.address)) LIKE '%' || unaccent(lower(${q})) || '%'
              OR GREATEST(
                   word_similarity(unaccent(lower(${q})), unaccent(lower(p.name))),
                   word_similarity(unaccent(lower(p.name)), unaccent(lower(${q})))
                 ) > 0.25
              OR ${hasSemantic ? Prisma.sql`(1 - (p.description_embedding <=> ${Prisma.raw(`'${vectorSql}'`)}::vector)) > 0.4` : Prisma.sql`false`}
            )
            AND (
              unaccent(lower(p.province))   LIKE '%' || unaccent(lower(${city})) || '%'
              OR unaccent(lower(p.address)) LIKE '%' || unaccent(lower(${city})) || '%'
            )
            ${indoorOutdoorCondition}
            ${isLandmarkCondition}
            ${idsCondition}
            ${minPriceCondition}
            ${maxPriceCondition}
            ORDER BY
              GREATEST(
                word_similarity(unaccent(lower(${q})), unaccent(lower(p.name))),
                word_similarity(unaccent(lower(p.name)), unaccent(lower(${q}))),
                CASE WHEN unaccent(lower(p.province)) LIKE '%' || unaccent(lower(${q})) || '%' THEN 2.0 ELSE 0.0 END,
                CASE WHEN unaccent(lower(p.address)) LIKE '%' || unaccent(lower(${q})) || '%' THEN 1.5 ELSE 0.0 END,
                ${semanticScoreField}
              ) DESC,
              p.popularity_score DESC,
              p.place_id ASC
            LIMIT ${limit} OFFSET ${skip}
          `;
        } else {
          // Tìm kiếm tự do không có city
          rows = await prisma.$queryRaw<any[]>`
            SELECT p.*,
                   GREATEST(
                     word_similarity(unaccent(lower(${q})), unaccent(lower(p.name))),
                     word_similarity(unaccent(lower(p.name)), unaccent(lower(${q}))),
                     CASE WHEN unaccent(lower(p.province)) LIKE '%' || unaccent(lower(${q})) || '%' THEN 2.0 ELSE 0.0 END,
                     CASE WHEN unaccent(lower(p.address)) LIKE '%' || unaccent(lower(${q})) || '%' THEN 1.5 ELSE 0.0 END,
                     ${semanticScoreField}
                   ) as final_score
            FROM place p
            WHERE
              unaccent(lower(p.province)) LIKE '%' || unaccent(lower(${q})) || '%'
              OR unaccent(lower(p.name)) LIKE '%' || unaccent(lower(${q})) || '%'
              OR unaccent(lower(p.address)) LIKE '%' || unaccent(lower(${q})) || '%'
              OR GREATEST(
                   word_similarity(unaccent(lower(${q})), unaccent(lower(p.name))),
                   word_similarity(unaccent(lower(p.name)), unaccent(lower(${q})))
                 ) > 0.25
              OR ${hasSemantic ? Prisma.sql`(1 - (p.description_embedding <=> ${Prisma.raw(`'${vectorSql}'`)}::vector)) > 0.4` : Prisma.sql`false`}
            ${indoorOutdoorCondition}
            ${isLandmarkCondition}
            ${idsCondition}
            ${minPriceCondition}
            ${maxPriceCondition}
            ORDER BY
              GREATEST(
                word_similarity(unaccent(lower(${q})), unaccent(lower(p.name))),
                word_similarity(unaccent(lower(p.name)), unaccent(lower(${q}))),
                CASE WHEN unaccent(lower(p.province)) LIKE '%' || unaccent(lower(${q})) || '%' THEN 2.0 ELSE 0.0 END,
                CASE WHEN unaccent(lower(p.address)) LIKE '%' || unaccent(lower(${q})) || '%' THEN 1.5 ELSE 0.0 END,
                ${semanticScoreField}
              ) DESC,
              p.popularity_score DESC,
              p.place_id ASC
            LIMIT ${limit} OFFSET ${skip}
          `;
        }

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

      const min_price = query['min_price'] ? Number(query['min_price']) : undefined;
      const max_price = query['max_price'] ? Number(query['max_price']) : undefined;
      if (min_price !== undefined && !isNaN(min_price)) {
        whereClause.min_price = { gte: min_price };
      }
      if (max_price !== undefined && !isNaN(max_price)) {
        whereClause.max_price = { lte: max_price };
      }

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
