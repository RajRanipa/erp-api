import express from 'express';
import * as Auth from '../controllers/gateWayAuthController.js';
import {gatewayAuth} from "../middleware/gatewayAuth.js";
const router = express.Router();

router.post('/login', Auth.gateWayLogin);

router.post('/refresh-token', gatewayAuth, Auth.gateWayRefreshToken);

export default router;