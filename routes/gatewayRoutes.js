import express from "express";
import gatewayAuth from "../middleware/gatewayAuth.js";
import { ingestBlanketProduction } from "../controllers/gatewayProductionController.js";

const router = express.Router();

router.post("/blanket/production", gatewayAuth, ingestBlanketProduction);

export default router;