import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ALL_PERMISSION_KEYS,
  DEFAULT_ROLE_TEMPLATES,
  normalizeRoleKey,
} from '../config/permissionCatalog.js';
import { canManageRole, permissionImplies } from '../services/accessControlService.js';
import Invite from '../models/Invite.js';
import Membership from '../models/Membership.js';
import Permission from '../models/Permission.js';
import Role from '../models/Role.js';
import User from '../models/User.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));

test('permission catalogue has unique normalized keys', () => {
  assert.equal(new Set(ALL_PERMISSION_KEYS).size, ALL_PERMISSION_KEYS.length);
  for (const key of ALL_PERMISSION_KEYS) {
    assert.match(key, /^[a-z][a-z0-9_-]*(?::[a-z][a-z0-9_-]*)+$/);
  }
});

test('every route authorization requirement exists in the permission catalogue', () => {
  const routesDir = path.resolve(dirname, '../routes');
  const routeFiles = fs.readdirSync(routesDir).filter((name) => name.endsWith('.js'));
  const required = new Set();
  for (const filename of routeFiles) {
    const source = fs.readFileSync(path.join(routesDir, filename), 'utf8');
    for (const match of source.matchAll(/roleAuth\(([^)]*)\)/g)) {
      for (const permission of match[1].matchAll(/['"]([^'"]+)['"]/g)) {
        required.add(permission[1]);
      }
    }
  }
  const missing = [...required].filter((permission) => !ALL_PERMISSION_KEYS.includes(permission));
  assert.deepEqual(missing, []);
});

test('default owner role is protected and receives the complete catalogue', () => {
  const owner = DEFAULT_ROLE_TEMPLATES.find((role) => role.key === 'owner');
  assert.equal(owner.isOwner, true);
  assert.equal(owner.rank, 100);
  assert.deepEqual([...owner.permissions].sort(), [...ALL_PERMISSION_KEYS].sort());
});

test('role authority prevents peer and owner escalation', () => {
  const manager = { isOwner: false, role: { rank: 70 } };
  assert.equal(canManageRole(manager, { rank: 50, isOwner: false }), true);
  assert.equal(canManageRole(manager, { rank: 70, isOwner: false }), false);
  assert.equal(canManageRole(manager, { rank: 100, isOwner: true }), false);
  assert.equal(canManageRole({ isOwner: true }, { rank: 100, isOwner: true }), true);
});

test('permission implication only expands resource full access', () => {
  assert.equal(permissionImplies(['inventory:full'], 'inventory:issue'), true);
  assert.equal(permissionImplies(['inventory:read'], 'inventory:issue'), false);
  assert.equal(permissionImplies(['items:read'], 'items:read'), true);
});

test('company RBAC schemas enforce tenant isolation and safe invite secrets', () => {
  const membershipUnique = Membership.schema.indexes().find(
    ([keys, options]) => keys.userId === 1 && keys.companyId === 1 && options.unique,
  );
  const roleUnique = Role.schema.indexes().find(
    ([keys, options]) => keys.companyId === 1 && keys.key === 1 && options.unique,
  );
  assert.ok(membershipUnique);
  assert.ok(roleUnique);
  assert.equal(Invite.schema.path('tokenHash').options.select, false);
  assert.equal(Invite.schema.path('roleId').isRequired, true);
  assert.equal(Permission.schema.path('roles'), undefined);
  assert.deepEqual(User.schema.path('role').enumValues, []);
});

test('custom role keys are deterministic and safe', () => {
  assert.equal(normalizeRoleKey(' Purchase Supervisor '), 'purchase_supervisor');
  assert.equal(normalizeRoleKey('OWNER<script>'), 'ownerscript');
});

