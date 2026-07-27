import assert from 'node:assert/strict';
import { afterEach, test, mock } from 'node:test';
import mongoose from 'mongoose';
import InventoryLedger from '../models/InventoryLedger.js';
import InventorySnapshot from '../models/InventorySnapshot.js';
import Item from '../models/Item.js';
import Warehouse from '../models/Warehouse.js';
import { receive } from '../services/inventoryService.js';

afterEach(() => {
  mock.restoreAll();
});

function resolvedQuery(value, { events, label, session }) {
  let attachedSession = null;
  const query = {
    select() {
      return query;
    },
    lean() {
      return query;
    },
    session(valueToAttach) {
      attachedSession = valueToAttach;
      return query;
    },
    then(resolve, reject) {
      events?.push(`${label}:start`);
      return new Promise(settle => {
        setImmediate(() => {
          if (session) assert.equal(attachedSession, session);
          events?.push(`${label}:end`);
          settle(value);
        });
      }).then(resolve, reject);
    },
  };
  return query;
}

function inventoryFixture() {
  const companyId = new mongoose.Types.ObjectId();
  const itemId = new mongoose.Types.ObjectId();
  const warehouseId = new mongoose.Types.ObjectId();
  return {
    companyId,
    itemId,
    warehouseId,
    item: {
      _id: itemId,
      companyId,
      name: 'Blanket Roll',
      categoryKey: 'FG',
      productType: new mongoose.Types.ObjectId(),
      UOM: 'roll',
      status: 'active',
    },
  };
}

test('gateway receipt serializes all operations that share a transaction session', async () => {
  const fixture = inventoryFixture();
  const events = [];
  let transactionCalls = 0;
  let sessionEnded = false;

  const session = {
    async withTransaction(work) {
      transactionCalls += 1;
      return work();
    },
    async endSession() {
      sessionEnded = true;
    },
  };

  mock.method(mongoose, 'startSession', async () => session);
  mock.method(Item, 'findOne', () => resolvedQuery(fixture.item, {
    events,
    label: 'item',
    session,
  }));
  mock.method(Warehouse, 'exists', () => resolvedQuery({ _id: fixture.warehouseId }, {
    events,
    label: 'warehouse',
    session,
  }));
  mock.method(InventoryLedger, 'findOne', () => resolvedQuery(null, {
    events,
    label: 'idempotency',
    session,
  }));
  mock.method(InventoryLedger, 'create', async (_documents, options) => {
    assert.equal(options.session, session);
    events.push('ledger');
    return [{ _id: new mongoose.Types.ObjectId() }];
  });
  mock.method(InventorySnapshot, 'incOnHand', async (_identity, _qty, activeSession) => {
    assert.equal(activeSession, session);
    events.push('snapshot');
    return { _id: new mongoose.Types.ObjectId(), onHand: 1 };
  });

  const result = await receive({
    companyId: fixture.companyId,
    itemId: fixture.itemId,
    warehouseId: fixture.warehouseId,
    uom: 'roll',
    qty: 1,
    idempotencyKey: 'PROD_GATEWAY:test:record:1',
  });

  assert.equal(transactionCalls, 1);
  assert.equal(sessionEnded, true);
  assert.equal(result.duplicate, false);
  assert.deepEqual(events, [
    'item:start',
    'item:end',
    'warehouse:start',
    'warehouse:end',
    'idempotency:start',
    'idempotency:end',
    'ledger',
    'snapshot',
  ]);
});

test('gateway receipt can complete when withTransaction retries a transient failure', async () => {
  const fixture = inventoryFixture();
  let callbackAttempts = 0;
  let ledgerAttempts = 0;
  let sessionEnded = false;

  const session = {
    async withTransaction(work) {
      while (callbackAttempts < 2) {
        callbackAttempts += 1;
        try {
          return await work();
        } catch (error) {
          if (!error.hasErrorLabel?.('TransientTransactionError')) throw error;
        }
      }
      throw new Error('Transaction retry did not complete');
    },
    async endSession() {
      sessionEnded = true;
    },
  };

  mock.method(mongoose, 'startSession', async () => session);
  mock.method(Item, 'findOne', () => resolvedQuery(fixture.item, {}));
  mock.method(Warehouse, 'exists', () => resolvedQuery({ _id: fixture.warehouseId }, {}));
  mock.method(InventoryLedger, 'findOne', () => resolvedQuery(null, {}));
  mock.method(InventoryLedger, 'create', async () => {
    ledgerAttempts += 1;
    if (ledgerAttempts === 1) {
      const error = new Error('simulated write conflict');
      error.hasErrorLabel = label => label === 'TransientTransactionError';
      throw error;
    }
    return [{ _id: new mongoose.Types.ObjectId() }];
  });
  mock.method(InventorySnapshot, 'incOnHand', async () => ({
    _id: new mongoose.Types.ObjectId(),
    onHand: 1,
  }));

  const result = await receive({
    companyId: fixture.companyId,
    itemId: fixture.itemId,
    warehouseId: fixture.warehouseId,
    uom: 'roll',
    qty: 1,
    idempotencyKey: 'PROD_GATEWAY:test:retry:1',
  });

  assert.equal(callbackAttempts, 2);
  assert.equal(ledgerAttempts, 2);
  assert.equal(sessionEnded, true);
  assert.equal(result.duplicate, false);
});
