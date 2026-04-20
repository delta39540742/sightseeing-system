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
import type { ReplanDeps, ReplanBody, RejectBody, TripParams, ProposalParams } from './handlers';
import {
  makeReplanHandler,
  makeAcceptHandler,
  makeRejectHandler,
} from './handlers';

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
  fastify.post<{ Params: TripParams; Body: ReplanBody }>(
    '/trips/:tripId/replan',
    {
      schema: {
        params: tripParamsSchema,
        body: replanBodySchema,
      },
    },
    makeReplanHandler(deps),
  );

  // ── POST /api/trips/:tripId/replan/:proposalId/accept ───────────────────
  fastify.post<{ Params: ProposalParams }>(
    '/trips/:tripId/replan/:proposalId/accept',
    {
      schema: {
        params: proposalParamsSchema,
      },
    },
    makeAcceptHandler(deps),
  );

  // ── POST /api/trips/:tripId/replan/:proposalId/reject ───────────────────
  fastify.post<{ Params: ProposalParams; Body: RejectBody }>(
    '/trips/:tripId/replan/:proposalId/reject',
    {
      schema: {
        params: proposalParamsSchema,
        body: rejectBodySchema,
      },
    },
    makeRejectHandler(deps),
  );
}

export default replanPlugin;
