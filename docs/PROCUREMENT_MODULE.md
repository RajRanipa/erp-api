# Procurement / Purchase Module

## Scope

The module implements a controlled purchase-to-pay workflow:

1. Create a purchase order using active suppliers, warehouses, and purchasable Items.
2. Submit and approve/reject the order.
3. Receive one or more partial deliveries.
4. Inspect each receipt line as accepted, rejected, or quarantined.
5. Post accepted material to the immutable inventory ledger.
6. Resolve quarantined material later as accepted or rejected.
7. Return accepted stock to the supplier using its original warehouse, batch, bin, and UOM.
8. Record supplier invoices and run a PO/GRN/invoice three-way match.
9. Approve matched invoices or explicitly approve documented exceptions.

The gateway/production ingestion API is unchanged. Procurement uses the same
`inventoryService` transaction boundary as production, so InventoryLedger and
InventorySnapshot remain authoritative for every item category (`RAW`,
`PACKING`, and `FG`).

## Collections

- `documentsequences`: tenant/year-scoped document numbers.
- `purchaseorders`: commercial order, status history, receipt and invoice counters.
- `goodsreceipts`: receipt, inspection disposition, and inventory posting references.
- `purchasereturns`: supplier returns and inventory issue references.
- `purchaseinvoices`: supplier invoice, computed totals, and three-way match variances.

Every operational query and unique document index is tenant-scoped by
`companyId`.

## Important guarantees

- `companyId` always comes from the authenticated membership, never request data.
- Supplier, Item, warehouse, PO, GRN, return, and invoice links are validated
  inside the same company.
- Commercial totals are recalculated on the server. Client totals are previews.
- Document links become immutable after draft creation.
- Status transitions are explicit and audited.
- PO/GRN/return inventory postings use MongoDB transactions and stable
  idempotency keys.
- Accepted stock is posted; rejected/quarantined stock is not.
- Quarantine acceptance is posted only when inspection is resolved.
- Returns use the exact original inventory bucket and cannot exceed unreturned
  accepted quantity.
- Invoice verification reserves the PO line's cumulative invoiced quantity in
  the same transaction, preventing two simultaneous invoices from both passing.
- Cancelling a verified invoice releases its PO invoice allocation.
- Posted inventory documents are not editable or cancellable.

## Permissions

- `procurement:read`
- `procurement:create`
- `procurement:update`
- `procurement:submit`
- `procurement:approve`
- `procurement:receive`
- `procurement:return`
- `procurement:invoice`
- `procurement:cancel`

The migration adds the appropriate new permissions to existing system roles.
Custom roles remain under administrator control.

## Deployment

Run an audit first:

```bash
npm run audit:procurement-module
```

Then apply once for each deployed database (local and Render):

```bash
npm run migrate:procurement-module
```

The apply command synchronizes permission definitions, grants the new default
permissions to existing system roles, creates procurement indexes, and records
`procurement-module-v1` in `systemmigrations`. It does not alter inventory,
gateway, party, item, warehouse, or production records.

It also increments the access version of active memberships using affected
system roles. Existing sessions must sign in again once so the frontend JWT
and backend role permissions cannot disagree.

## API root

`/api/procurement`

Resource groups:

- `/summary`
- `/lookups/:type`
- `/orders`
- `/receipts`
- `/returns`
- `/invoices`

List APIs support server-side pagination, status/date filtering, document
search, and supplier-prefix search.

## Operational note

MongoDB transactions require a replica set. MongoDB Atlas and the production
Render/Atlas deployment satisfy this. A standalone local MongoDB instance
must be started as a replica set before GRN, quarantine, return, or invoice
verification transactions can be posted.
