// backend/src/routes/index.ts
import { Router } from 'express';
import evalsRoutes from './evals.js';
import { authentication } from '../middleware/authentication.js';

const router = Router();

router.use(authentication);
router.use('/evals', evalsRoutes);

export default router;
