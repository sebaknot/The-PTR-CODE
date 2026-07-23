import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import portersRouter from "./porters";
import deliveriesRouter from "./deliveries";
import trackingRouter from "./tracking";
import demoRouter from "./demo";
import paymentsRouter, { paymentsPublicRouter } from "./payments";
import porterBoxesRouter from "./porter-boxes";
import { uploadsAuthRouter, uploadsPublicRouter } from "./uploads";
import { authRouter, requireAuth } from "./auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(demoRouter);
router.use(paymentsPublicRouter);
router.use(uploadsPublicRouter);

router.use(requireAuth);
router.use(usersRouter);
router.use(portersRouter);
router.use(deliveriesRouter);
router.use(porterBoxesRouter);
router.use(trackingRouter);
router.use(paymentsRouter);
router.use(uploadsAuthRouter);

export default router;
