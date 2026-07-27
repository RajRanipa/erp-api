import assert from 'node:assert/strict';
import { test } from 'node:test';
import mongoose from 'mongoose';
import Party, {
  PARTY_ROLES,
  buildPartySearchPrefixes,
} from '../models/Party.js';
import {
  buildPartyFilter,
  castPartyCompanyId,
  dataQualityForParty,
  normalizePartyPayload,
} from '../services/partyService.js';

function validPayload(overrides = {}) {
  return {
    name: 'Orient Fibertech',
    partyType: 'BUSINESS',
    roles: ['SUPPLIER', 'CUSTOMER', 'SUPPLIER'],
    status: 'active',
    lifecycleStage: 'ACTIVE',
    priority: 'HIGH',
    phone: '+91 98765 43210',
    email: 'ACCOUNTS@EXAMPLE.COM',
    website: 'example.com',
    addresses: {
      primaryAddress: {
        label: 'Registered Office',
        purposes: ['registered', 'billing'],
        line1: 'Industrial Estate',
        city: 'Ahmedabad',
        state: 'Gujarat',
        country: 'India',
        pincode: '380015',
      },
      additionalAddresses: [],
    },
    contacts: [{
      name: 'Asha',
      email: 'ASHA@EXAMPLE.COM',
      isPrimary: true,
    }],
    taxProfile: {
      isTaxRegistered: true,
      taxIdType: 'GSTIN',
      taxId: '24AAAAA0000A1Z5',
      pan: 'AAAAA0000A',
      gstRegistrationType: 'REGULAR',
    },
    paymentTerms: { type: 'NET_DAYS', netDays: 30 },
    currency: 'inr',
    creditLimit: '250000',
    tags: [' Strategic ', 'strategic', 'West'],
    ...overrides,
  };
}

test('normalizes a CRM-ready business partner payload', () => {
  const payload = normalizePartyPayload(validPayload());
  assert.deepEqual(payload.roles, [
    PARTY_ROLES.SUPPLIER,
    PARTY_ROLES.CUSTOMER,
  ]);
  assert.equal(payload.email, 'accounts@example.com');
  assert.equal(payload.website, 'https://example.com');
  assert.equal(payload.currency, 'INR');
  assert.equal(payload.creditLimit, 250000);
  assert.deepEqual(payload.tags, ['strategic', 'west']);
  assert.equal(payload.contacts[0].email, 'asha@example.com');
  assert.equal(payload.addresses.primaryAddress.purposes.includes('billing'), true);
});

test('rejects incomplete registered tax details', () => {
  assert.throws(
    () => normalizePartyPayload(validPayload({
      taxProfile: {
        isTaxRegistered: true,
        taxIdType: 'GSTIN',
        taxId: '',
      },
    })),
    /Tax ID is required/,
  );
});

test('builds indexed prefix search filters', () => {
  const companyId = new mongoose.Types.ObjectId();
  const filter = buildPartyFilter(companyId, {
    q: 'Orient 9876',
    role: 'supplier',
    status: 'active',
  });
  assert.equal(filter.companyId, companyId);
  assert.equal(filter.roles, 'SUPPLIER');
  assert.equal(filter.status, 'active');
  assert.deepEqual(filter.$or[0], {
    searchPrefixes: { $all: ['orient', '9876'] },
  });
});

test('casts JWT company strings for MongoDB aggregation pipelines', () => {
  const companyId = new mongoose.Types.ObjectId();
  const cast = castPartyCompanyId(companyId.toString());
  assert.equal(cast instanceof mongoose.Types.ObjectId, true);
  assert.equal(cast.equals(companyId), true);
  assert.throws(
    () => castPartyCompanyId('not-an-object-id'),
    /Invalid company context/,
  );
});

test('party validation generates a tenant-friendly code and search prefixes', async () => {
  const payload = normalizePartyPayload(validPayload());
  const party = new Party({
    ...payload,
    companyId: new mongoose.Types.ObjectId(),
  });
  await party.validate();
  assert.match(party.code, /^BP-[A-F0-9]{12}$/);
  assert.equal(party.searchPrefixes.includes('orie'), true);
  assert.equal(party.searchPrefixes.includes('9876'), true);
});

test('data quality reports missing CRM foundation fields', () => {
  const result = dataQualityForParty({
    name: 'Example',
    partyType: 'BUSINESS',
    taxProfile: { isTaxRegistered: false },
    paymentTerms: { type: 'NET_DAYS' },
  });
  assert.equal(result.score < 100, true);
  assert.equal(result.missing.includes('account owner'), true);
  assert.equal(result.missing.includes('primary address'), true);
});

test('search prefix generation covers contact names and tax IDs', () => {
  const prefixes = buildPartySearchPrefixes({
    name: 'Orient Fibertech',
    taxProfile: { taxId: '24AAAAA0000A1Z5' },
    contacts: [{ name: 'Asha Patel' }],
  });
  assert.equal(prefixes.includes('orie'), true);
  assert.equal(prefixes.includes('asha'), true);
  assert.equal(prefixes.includes('24aa'), true);
});

test('tenant unique indexes match the migration-safe definitions', () => {
  const indexes = Party.schema.indexes();
  const byName = Object.fromEntries(
    indexes
      .filter(([, options]) => options.name)
      .map(([keys, options]) => [options.name, { keys, options }]),
  );

  assert.deepEqual(
    byName.uniq_company_party_code.keys,
    { companyId: 1, code: 1 },
  );
  assert.equal(byName.uniq_company_party_code.options.unique, true);
  assert.equal(
    byName.uniq_company_party_code.options.partialFilterExpression,
    undefined,
  );
  assert.deepEqual(
    byName.uniq_company_tax_id.options.partialFilterExpression,
    { 'taxProfile.taxId': { $type: 'string' } },
  );
});
