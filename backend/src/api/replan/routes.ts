/**
 * routes.ts — Fastify plugin that registers the three replan endpoints.
 *
 * Routes:
 *   POST /api/trips/:tripId/replan
 *   POST /api/trips/:tripId/replan/:proposalId/accept
 *   POST /api/trips/:tripId/replan/:proposalId/reject
 *
 * Usage:
 *   fastify.register(replanPlugin, { prefix: '/api', deps });
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { ReplanDeps } from './handlers.js';
import {
  makeReplanHandler,
  makeAcceptHandler,
  makeRejectHandler,
} from './handlers.js';

// ---------------------------------------------------------------------------
// JSON Schema definitions
// ---------------------------------------------------------------------------

const uuidPattern = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

const tripParamsSchema = {
  type: 'object',
  required: ['tripId'],
  properties: {
    tripId: { type: 'string', pattern: uuidPattern },
  },
} as const;

const proposalParamsSchema = {
  type: 'object',
  required: ['tripId', 'proposalId'],
  properties: {
    tripId: { type: 'string', pattern: uuidPattern },
    proposalId: { type: 'string', pattern: uuidPattern },
  },
} as const;

const replanBodySchema = {
  type: 'object',
  required: ['replanScope'],
  properties: {
    triggeredByEventId: { type: 'string', pattern: uuidPattern },
    replanScope: { type: 'string', enum: ['remaining_day', 'remaining_trip'] },
  },
  additionalProperties: false,
} as const;

const rejectBodySchema = {
  type: 'object',
  properties: {
    reason: { type: 'string', maxLength: 500 },
  },
  additionalProperties: false,
} as const;

// Common error response shapes for OpenAPI / Fastify schema
const errorSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    message: { type: 'string' },
    details: { type: 'object' },
  },
} as const;

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

export interface ReplanPluginOptions extends FastifyPluginOptions {
  deps: ReplanDeps;
}

/**
 * Fastify plugin — registers replan routes under the caller-supplied prefix.
 *
 * @example
 * fastify.register(replanPlugin, { prefix: '/api', deps });
 */
export async function replanPlugin(
  fastify: FastifyInstance,
  options: ReplanPluginOptions,
): Promise<void> {
  const { deps } = options;

  // ── POST /api/trips/:tripId/replan ──────────────────────────────────────
  fastify.post<{
    Params: { tripId: string };
    Body: { triggeredByEventId?: string; replanScope: string };
  }>(
    '/trips/:tripId/replan',
    {
      schema: {
        params: tripParamsSchema,
        body: replanBodySchema,
        response: {
          201: { $ref: 'ReplanProposal#' },
          404: errorSchema,
          409: errorSchema,
          422: errorSchema,
        },
      },
    },
    makeReplanHandler(deps),
  );

  // ── POST /api/trips/:tripId/replan/:proposalId/accept ───────────────────
  fastify.post<{
    Params: { tripId: string; proposalId: string };
  }>(
    '/trips/:tripId/replan/:proposalId/accept',
    {
      schema: {
        params: proposalParamsSchema,
        response: {
          200: { $ref: 'Trip#' },
          404: errorSchema,
          409: errorSchema,
        },
      },
    },
    makeAcceptHandler(deps),
  );

  // ── POST /api/trips/:tripId/replan/:proposalId/reject ───────────────────
  fastify.post<{
    Params: { tripId: string; proposalId: string };
    Body: { reason?: string };
  }>(
    '/trips/:tripId/replan/:proposalId/reject',
    {
      schema: {
        params: proposalParamsSchema,
        body: rejectBodySchema,
        response: {
          204: { type: 'null' },
          404: errorSchema,
          409: errorSchema,
        },
      },
    },
    makeRejectHandler(deps),
  );
}

export default replanPlugin;
