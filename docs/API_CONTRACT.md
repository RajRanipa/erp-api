# ERP API response contract

Every JSON endpoint, including Gateway endpoints, returns the same versioned
envelope:

```json
{
  "apiVersion": "1.0",
  "success": true,
  "status": true,
  "statusCode": 200,
  "message": "Optional human-readable result",
  "data": {},
  "meta": null,
  "error": null,
  "requestId": "7a0dd700-0c41-4ab9-8fb3-bf372ec67426",
  "timestamp": "2026-07-27T10:00:00.000Z"
}
```

Errors use the same top-level keys:

```json
{
  "apiVersion": "1.0",
  "success": false,
  "status": false,
  "statusCode": 400,
  "message": "Validation failed",
  "data": null,
  "meta": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "details": [
      { "field": "name", "message": "Name is required" }
    ]
  },
  "requestId": "7a0dd700-0c41-4ab9-8fb3-bf372ec67426",
  "timestamp": "2026-07-27T10:00:00.000Z"
}
```

`status` is retained temporarily as a compatibility alias for older ERP and
gateway clients. New code should use `success`.

## Frontend usage

Use `apiClient` for new and migrated code:

```js
import { apiClient, getApiErrorMessage } from '@/lib/axiosInstance';

try {
  const result = await apiClient.get('/api/items');
  setItems(result.data);
} catch (error) {
  Toast.error(getApiErrorMessage(error));
}
```

`result` always contains `data`, `message`, `meta`, `statusCode`, `requestId`,
and the underlying Axios `response`.

The Axios compatibility adapter keeps existing screens operational while they
are migrated. All requests also send `X-Request-ID`; the backend returns the
same value so frontend reports can be matched to backend logs.

## Loading behavior

Every Axios request participates in the global non-blocking activity indicator.
Set `skipGlobalLoading: true` only for silent polling or background refreshes.
Pages should continue to use local skeletons for first-load layout stability and
button spinners for mutations.

## Gateway

All `/gateway/*` routes require:

```http
X-Gateway-Key: <GATEWAY_KEY>
```

Render must define both `GATEWAY_KEY` and `GATEWAY_COMPANY_ID`. The production
line sender must include the key header on health and production-ingest calls.

Gateway login returns both `accessToken` and `refreshToken` inside `data`.
Send the returned refresh token on refresh:

```json
{
  "device": "gateway",
  "refreshToken": "<data.refreshToken>"
}
```

The legacy `userId` refresh format remains temporarily supported for installed
clients authenticated with `X-Gateway-Key`. Its response includes a deprecation
message in `meta`.

### Production product and inventory resolution

PLC product codes resolve to ProductType names:

```text
1 blanket
2 bulk
3 board
4 module
5 et
```

The gateway populates the ProductType's `categories` and matches the active
tenant Item inside a compatible parent category. It does not assume every
gateway output is Finished Goods:

- accepted output excludes the `NC` category;
- rejected output excludes the `FG` category;
- product code `5` remains inventory-eligible and normally resolves to an
  `et` Item in `NC / non-conformance`;
- the matched Item's UOM controls conversion from the PLC weight in kilograms;
- rejected ET inventory does not increment good-production totals.

Unmatched or ambiguous Items leave the production record in `PENDING`/`FAILED`
inventory state for reconciliation. They are never acknowledged as inventory
posted without an idempotent InventoryLedger receipt.
