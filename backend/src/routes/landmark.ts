import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { mockIdentify, recognitionStore } from '../services/landmark.service';
import { InternalEventBus } from '../events/eventBus';

export async function landmarkPlugin(fastify: FastifyInstance): Promise<void> {
  await fastify.register(multipart);

  // POST /api/landmark/recognize — nhận diện địa danh qua file upload
  fastify.post('/recognize', async (request, reply) => {
    const parts = request.parts();
    let filename = '';

    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'image') {
        filename = part.filename;
        await part.toBuffer();
      }
    }

    if (!filename) return reply.status(400).send({ error: 'MOCK_NO_MATCH' });

    const result = mockIdentify(filename);
    if (!result) return reply.status(400).send({ error: 'MOCK_NO_MATCH' });

    const recognitionId = `recog_${Date.now()}`;
    recognitionStore.set(recognitionId, result.placeId);

    return {
      recognitionId,
      landmarkClassId: result.classId,
      placeId: result.placeId,
      place: result.place,
      confidence: 0.98,
      isMock: true,
    };
  });

  // GET /api/landmark/recognition/:recognitionId — tra cứu kết quả nhận diện
  fastify.get('/recognition/:recognitionId', async (request, reply) => {
    const { recognitionId } = request.params as { recognitionId: string };
    const placeId = recognitionStore.get(recognitionId);

    if (!placeId) return reply.status(404).send({ error: 'RECOGNITION_NOT_FOUND' });

    return { recognitionId, placeId };
  });

  // POST /api/landmark/:recognitionId/add-to-trip — thêm địa danh vào chuyến đi
  fastify.post('/:recognitionId/add-to-trip', async (request, reply) => {
    const { recognitionId } = request.params as { recognitionId: string };
    const { tripId } = request.body as { tripId: string };

    const placeId = recognitionStore.get(recognitionId);
    if (!placeId) return reply.status(404).send({ error: 'RECOGNITION_NOT_FOUND' });

    InternalEventBus.publish('trip.event.detected', {
      eventId: `evt_${Date.now()}`,
      tripId,
      eventType: 'user_interest_discovered',
      source: 'landmark_recognition',
      payload: { placeId },
      createdAt: new Date().toISOString(),
    });

    return reply.status(201).send({
      proposalId: `prop_mock_${Date.now()}`,
      newScore: 95,
      changes: [`Đã cập nhật lộ trình thêm điểm: ${placeId}`],
      status: 'pending',
    });
  });
}
