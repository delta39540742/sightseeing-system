// src/api/trips/routes.ts
import { FastifyInstance } from 'fastify';
import { getTripCandidates } from './handlers';

export default async function tripRoutes(fastify: FastifyInstance) {
  // Định nghĩa endpoint theo đặc tả: POST /api/trips/candidates
  fastify.post('/candidates', getTripCandidates);
  
  // Bạn có thể thêm các route khác của Người số 4 ở đây sau này
  // fastify.post('/', createTrip); 
}