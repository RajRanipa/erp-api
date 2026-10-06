import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGatewayBatchResponse } from '../services/gatewayProductionService.js';

test('gateway response carries acknowledgements and print jobs exactly once', () => {
  const printJob = {
    jobId: 'SERIAL_LABEL:5586086916306608',
    template: 'BLANKET_ROLL_TRACE_V1',
  };
  const response = buildGatewayBatchResponse({
    gatewayId: 'pi-gateway-1',
    batchId: 'batch-1',
    status: 'PROCESSED',
    summary: {
      received: 1,
      inserted: 1,
      printJobsReady: 1,
    },
    recordResults: [{
      recordId: 'record-1',
      accepted: true,
      printStatus: 'READY',
      printJob,
    }],
  });

  assert.equal(response.gatewayId, 'pi-gateway-1');
  assert.equal(response.summary.received, 1);
  assert.equal(response.summary.recordResults, undefined);
  assert.equal(response.printJobs, undefined);
  assert.equal(response.recordResults[0].printJob, printJob);
  assert.equal(
    JSON.stringify(response).match(/SERIAL_LABEL:5586086916306608/g)?.length,
    1,
  );
});
