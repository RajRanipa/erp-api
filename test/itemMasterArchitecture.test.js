import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import {
  ITEM_ATTRIBUTE_CATALOG,
  ITEM_CLASS_CATALOG,
  ITEM_FAMILY_CATALOG,
} from '../config/itemMasterCatalog.js';
import {
  normalizeAttributeCode,
  normalizeItemAttributes,
  normalizeMasterCode,
  isPermanentlyDeletableItemStatus,
} from '../services/itemMasterService.js';

const id = () => new mongoose.Types.ObjectId();

test('Item V2 catalog references valid classes and attributes', () => {
  const classCodes = new Set(ITEM_CLASS_CATALOG.map(entry => entry.code));
  const attributeCodes = new Set(ITEM_ATTRIBUTE_CATALOG.map(entry => entry.code));
  assert.equal(classCodes.size, ITEM_CLASS_CATALOG.length);
  assert.equal(attributeCodes.size, ITEM_ATTRIBUTE_CATALOG.length);

  for (const family of ITEM_FAMILY_CATALOG) {
    assert.equal(classCodes.has(family.classCode), true, `${family.code} class exists`);
    assert.ok(family.uomPolicy.baseUom, `${family.code} has base UOM`);
    for (const rule of family.attributes) {
      assert.equal(
        attributeCodes.has(rule.attributeCode),
        true,
        `${family.code}.${rule.attributeCode} exists`,
      );
    }
  }
});

test('Blanket and ET catalog policies preserve required physical identity', () => {
  const blanket = ITEM_FAMILY_CATALOG.find(entry => entry.code === 'BLANKET');
  const et = ITEM_FAMILY_CATALOG.find(entry => entry.code === 'ET');

  assert.deepEqual(
    blanket.uomPolicy,
    { baseUom: 'roll', catchUom: 'kg', catchMode: 'MEASURED' },
  );
  assert.equal(blanket.trackingPolicy.serialTracked, true);
  assert.equal(blanket.trackingPolicy.serialControlMode, 'INFORMATIONAL');
  assert.deepEqual(
    et.attributes.map(rule => rule.attributeCode),
    ['classification_temperature'],
  );
});

test('all packaging families are stocked and consumed in whole numbers', () => {
  const packagingFamilies = ITEM_FAMILY_CATALOG.filter(
    family => family.classCode === 'PACKAGING',
  );
  assert.ok(packagingFamilies.length > 0);
  for (const family of packagingFamilies) {
    assert.deepEqual(
      family.uomPolicy,
      { baseUom: 'nos' },
      `${family.code} must use nos without a catch UOM`,
    );
  }
});

test('only currently active Items are status-blocked from permanent deletion', () => {
  assert.equal(isPermanentlyDeletableItemStatus('active'), false);
  for (const status of [
    'draft',
    'in_review',
    'returned',
    'approved',
    'blocked',
    'archived',
  ]) {
    assert.equal(isPermanentlyDeletableItemStatus(status), true, status);
  }
});

test('ceramic material families use classification temperature for segregation', () => {
  for (const familyCode of [
    'BLANKET',
    'BULK',
    'ET',
    'CHOPPED_FIBRE',
    'BOARD',
    'MODULE',
    'MODULE_STRIP',
  ]) {
    const family = ITEM_FAMILY_CATALOG.find(entry => entry.code === familyCode);
    const required = new Set(
      family.attributes
        .filter(attribute => attribute.required)
        .map(attribute => attribute.attributeCode),
    );
    assert.equal(required.has('classification_temperature'), true, familyCode);
  }
  assert.equal(
    ITEM_ATTRIBUTE_CATALOG.some(attribute => attribute.code === 'material_class'),
    false,
  );
});

test('Shorts identity is segregated by temperature only', () => {
  const shorts = ITEM_FAMILY_CATALOG.find(entry => entry.code === 'SHORTS');
  assert.deepEqual(
    shorts.attributes.map(attribute => attribute.attributeCode),
    ['classification_temperature'],
  );
});

test('typed family attributes create a stable identity fingerprint', () => {
  const temperature = {
    _id: id(),
    code: 'classification_temperature',
    label: 'Classification Temperature',
    dataType: 'select',
    unit: '°c',
    status: 'active',
    allowedValues: [
      { value: '1260', label: '1260 °C', active: true },
      { value: '1425', label: '1425 °C', active: true },
    ],
    validation: {},
  };
  const density = {
    _id: id(),
    code: 'density',
    label: 'Density',
    dataType: 'number',
    unit: 'kg/m³',
    status: 'active',
    allowedValues: [],
    validation: { min: 1, precision: 2 },
  };
  const family = {
    attributeRules: [
      { attributeId: density, required: true, identity: true, displayOrder: 2 },
      { attributeId: temperature, required: true, identity: true, displayOrder: 1 },
    ],
  };

  const result = normalizeItemAttributes(family, {
    density: '96.000',
    classification_temperature: '1260',
  });

  assert.equal(
    result.fingerprint,
    'classification_temperature=1260|density=96',
  );
  assert.equal(result.attributes[0].displayValue, '1260 °C');
  assert.equal(result.attributes[1].displayValue, '96 kg/m³');
});

test('master and attribute codes are canonicalized', () => {
  assert.equal(normalizeMasterCode(' fg blanket 1260 '), 'FG_BLANKET_1260');
  assert.equal(normalizeAttributeCode('Particle Size (Mesh)'), 'particle_size_mesh');
});
