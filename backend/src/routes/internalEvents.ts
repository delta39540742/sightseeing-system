import { Router } from 'express';
import { InternalEventBus } from '../events/eventBus';

const router = Router();

// POST /api/internal/events
// Receive events from other modules (e.g. Module 5 - Heavy Rain, Traffic)
router.post('/', (req, res) => {
  try {
    const { event_type, payload } = req.body;
    
    if (!event_type) {
      return res.status(400).json({ success: false, error: 'Missing event_type' });
    }

    // Emit event back into system event bus
    console.log(`[EventBus API] Pushing event: ${event_type}`);
    InternalEventBus.publish(event_type, payload || {});

    res.status(200).json({ 
      success: true, 
      message: `Emitted event: ${event_type}`
    });
  } catch (error) {
    console.error('Error handling internal event:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
