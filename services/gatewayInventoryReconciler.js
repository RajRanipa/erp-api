import { reconcilePendingGatewayInventory } from "./gatewayProductionService.js";

let timer = null;
let running = false;

const intervalMs = () => {
  const configured = Number(process.env.GATEWAY_RECONCILE_INTERVAL_MS || 60000);
  return Math.max(Number.isFinite(configured) ? configured : 60000, 10000);
};

async function runCycle() {
  if (running) return;
  running = true;
  try {
    const result = await reconcilePendingGatewayInventory({
      limit: Number(process.env.GATEWAY_RECONCILE_BATCH_SIZE || 100),
    });
    if (result.posted || result.failed) {
      console.log("[gateway:reconcile]", result);
    }
  } catch (error) {
    console.error("[gateway:reconcile]", {
      message: error?.message || String(error),
    });
  } finally {
    running = false;
  }
}

export function startGatewayInventoryReconciler() {
  if (timer || process.env.GATEWAY_RECONCILE_ENABLED !== "true") return;
  timer = setInterval(runCycle, intervalMs());
  timer.unref?.();
  setTimeout(runCycle, 10000).unref?.();
}

export function stopGatewayInventoryReconciler() {
  if (timer) clearInterval(timer);
  timer = null;
}
