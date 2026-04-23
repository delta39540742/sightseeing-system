import { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { mockIdentify, recognitionStore } from '../services/landmark.service';
import { publish } from '../utils/eventBus';

export async function landmarkRoutes(fastify: FastifyInstance) {
  // Đăng ký thư viện đọc file
  await fastify.register(multipart);

  
  // NHẬN DIỆN ẢNH (POST /api/landmark/recognize)
 
  fastify.post('/landmark/recognize', async (request, reply) => {
    const parts = request.parts();
    let filename = '';
    let tripId = ''; // Lấy tripId nếu frontend có gửi

    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'image') {
        filename = part.filename;
        await part.toBuffer(); // Xả bộ đệm file (bắt buộc)
      } else if (part.fieldname === 'tripId') {
        tripId = part.value as string;
      }
    }

    if (!filename) return reply.status(400).send({ error: 'MOCK_NO_MATCH' });

    const result = mockIdentify(filename);
    if (!result) return reply.status(400).send({ error: 'MOCK_NO_MATCH' });

    // Tạo ID nhận diện và lưu vào bộ nhớ tạm
    const recognitionId = `recog_${Date.now()}`;
    recognitionStore.set(recognitionId, result.placeId);

    // Trả kết quả chuẩn spec 3.8
    return {
      recognitionId,
      landmarkClassId: result.classId,
      placeId: result.placeId,
      place: result.place,
      confidence: 0.98,
      isMock: true
    };
  });


  //THÊM VÀO CHUYẾN ĐI (POST /api/landmark/:recognitionId/add-to-trip)

  fastify.post('/landmark/:recognitionId/add-to-trip', async (request, reply) => {
    const { recognitionId } = request.params as { recognitionId: string };
    const { tripId } = request.body as { tripId: string };

    const placeId = recognitionStore.get(recognitionId);
    if (!placeId) return reply.status(404).send({ error: 'RECOGNITION_NOT_FOUND' });

    // Tạo event chuẩn
    const tripEvent = {
      eventId: `evt_${Date.now()}`,
      tripId,
      eventType: 'user_interest_discovered',
      source: 'landmark_recognition',
      payload: { placeId },
      createdAt: new Date().toISOString()
    };

    // Bắn sự kiện ra hệ thống
    publish('trip.event.detected', tripEvent);

    return reply.status(201).send({
      proposalId: `prop_mock_${Date.now()}`,
      newScore: 95,
      changes: [`Đã cập nhật lộ trình thêm điểm: ${placeId}`],
      status: 'pending'
    });
  });
}
