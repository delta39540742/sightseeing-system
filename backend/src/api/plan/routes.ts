// src/api/trips/routes.ts
import { FastifyInstance } from 'fastify';
import { getTripCandidates, createTrip } from './handlers';
import { verifyToken, optionalVerifyToken } from '../../middlewares/authMiddleware';

const candidatesBodySchema = {
  type: 'object',
  properties: {
    destinationCity:      { type: 'string', minLength: 1, maxLength: 100 },
    startDate:            { type: 'string', format: 'date-time' },
    endDate:              { type: 'string', format: 'date-time' },
    budgetTotal:          { type: 'number', minimum: 0 },
    preferences:          { type: 'array', items: { type: 'string' }, maxItems: 20 },
    mobilityRestrictions: { type: 'array', items: { type: 'string' }, maxItems: 10 },
  },
  additionalProperties: false,
} as const;

const generateBodySchema = {
  type: 'object',
  required: ['startDate', 'endDate'],
  properties: {
    destinationCity:      { type: 'string', minLength: 1, maxLength: 100 },
    startDate:            { type: 'string', format: 'date-time' },
    endDate:              { type: 'string', format: 'date-time' },
    budgetTotal:          { type: 'number', minimum: 0 },
    preferences:          { type: 'array', items: { type: 'string' }, maxItems: 20 },
    preferredTagIds:      { type: 'array', items: { type: 'integer', minimum: 1 }, maxItems: 10 },
    anchorPlaceIds:       { type: 'array', items: { type: 'integer', minimum: 1 }, maxItems: 50 },
    strictMode:           { type: 'boolean' },
    mobilityRestrictions: { type: 'array', items: { type: 'string' }, maxItems: 10 },
    additionalNotes:      { type: 'string', maxLength: 1000 },
  },
  additionalProperties: false,
} as const;

export default async function tripRoutes(fastify: FastifyInstance) {
  // POST /api/plan/candidates — guest browse OK; nếu có token thì cá nhân hoá.
  // optionalVerifyToken xoá x-user-id header khi không có Bearer token hợp lệ
  // → handler không thể bị spoof preference data của user khác.
  fastify.post(
    '/candidates',
    { preHandler: optionalVerifyToken, schema: { body: candidatesBodySchema } },
    getTripCandidates,
  );

  // POST /api/plan/generate yêu cầu Firebase token để xác thực user
  fastify.post(
    '/generate',
    { preHandler: verifyToken, schema: { body: generateBodySchema } },
    createTrip,
  );
}