import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isTallyPartyExport,
  isTallyPlaceholderRow,
  mapTallyPartyRow,
} from '../services/tallyPartyImportMapper.js';

const headers = [
  '$Name',
  '$Parent',
  '$_Address1',
  '$_Address2',
  '$_Address3',
  '$_Address4',
  '$_Address5',
  '$LedStateName',
  '$PinCode',
  '$LedgerMobile',
  '$EMAIL',
  '$PartyGSTIN',
];

test('detects the supplied Tally ledger export format', () => {
  assert.equal(isTallyPartyExport(headers), true);
  assert.equal(isTallyPartyExport(['Name', 'Roles', 'TaxId']), false);
});

test('identifies the all-12 placeholder row in the supplied export', () => {
  const row = Object.fromEntries(headers.map(header => [header, '12']));
  assert.equal(isTallyPlaceholderRow(row), true);
  assert.equal(
    isTallyPlaceholderRow({ ...row, $Name: 'Real Ledger' }),
    false,
  );
});

test('identifies the styled empty row returned by the backend XLSX parser', () => {
  const row = Object.fromEntries(headers.map(header => [header, '']));
  assert.equal(isTallyPlaceholderRow(row), true);
});

test('maps a Tally Sundry Debtor row into the normal Party import format', () => {
  const mapped = mapTallyPartyRow({
    $Name: 'AADITYA CERAMICS PVT LTD',
    $Parent: 'Sundry Debtors',
    $_Address1: '27 NATIONAL HIGHWAY,',
    $_Address2: 'LALPAR,',
    $_Address3: 'WANKANER',
    $_Address4: '12',
    $_Address5: '12',
    $LedStateName: 'Gujarat',
    $PinCode: '363621',
    $LedgerMobile: '12',
    $EMAIL: '12',
    $PartyGSTIN: '24AAECA9044M1ZH',
  });

  assert.equal(mapped.Name, 'AADITYA CERAMICS PVT LTD');
  assert.equal(mapped.Roles, 'CUSTOMER');
  assert.equal(mapped.AddressLine1, '27 NATIONAL HIGHWAY');
  assert.equal(mapped.AddressLine2, 'LALPAR');
  assert.equal(mapped.City, 'WANKANER');
  assert.equal(mapped.Phone, '');
  assert.equal(mapped.Email, '');
  assert.equal(mapped.TaxRegistered, 'YES');
  assert.equal(mapped.TaxId, '24AAECA9044M1ZH');
  assert.equal(mapped.__importMeta.tally.parentGroup, 'Sundry Debtors');
});

test('maps Sundry Creditors to the supplier role', () => {
  const mapped = mapTallyPartyRow({
    $Name: 'Example Vendor',
    $Parent: 'Sundry Creditors',
  });
  assert.equal(mapped.Roles, 'SUPPLIER');
});

test('rejects non-party Tally ledger groups', () => {
  assert.throws(
    () => mapTallyPartyRow({
      $Name: 'Sales Account',
      $Parent: 'Sales Accounts',
    }),
    /Unsupported Tally party group/,
  );
});
