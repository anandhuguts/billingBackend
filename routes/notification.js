// routes/notification.js
import { Router } from 'express';
import {
  getNotifications,
  updateNotifications,

} from '../controllers/notificationcontroller.js';

const router = Router();

// Read the effective (merged) preferences for a tenant
router.get('/:id/notifications', getNotifications);

// Partially update selected preferences (jsonb merge)
router.put('/:id/notifications', updateNotifications);



export default router;
