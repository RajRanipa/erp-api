const define = (key, label, description = '') => ({
  key,
  label,
  description,
  module: key.split(':')[0],
});

export const PERMISSION_CATALOG = [
  define('dashboard:read', 'View dashboard'),
  define('settings:read', 'View settings'),
  define('manufacturing:read', 'Open manufacturing workspace'),
  define('crm:read', 'Open CRM workspace'),
  define('warehouse:read', 'Open warehouse workspace'),

  define('companies:create', 'Create company'),
  define('companies:read', 'View company'),
  define('companies:update', 'Update company'),
  define('companies:delete', 'Delete company'),
  define('companies:full', 'Manage company setup'),

  define('users:read', 'View members'),
  define('users:invite:read', 'View invitations'),
  define('users:invite:create', 'Invite members'),
  define('users:invite:resend', 'Resend invitations'),
  define('users:invite:revoke', 'Revoke invitations'),
  define('users:update:role', 'Change member roles'),
  define('users:remove', 'Suspend members'),
  define('users:restore', 'Restore members'),

  define('roles:read', 'View roles'),
  define('roles:create', 'Create roles'),
  define('roles:update', 'Update roles'),
  define('roles:delete', 'Delete roles'),
  define('roles:permissions:update', 'Assign role permissions'),
  define('permissions:read', 'View permission catalogue'),

  define('items:read', 'View items'),
  define('items:create', 'Create items'),
  define('items:update', 'Update items'),
  define('items:delete', 'Delete items'),
  define('items:status:update', 'Change item status'),

  define('inventory:read', 'View inventory'),
  define('inventory:receipt', 'Receive inventory'),
  define('inventory:issue', 'Issue inventory'),
  define('inventory:adjust', 'Adjust inventory'),
  define('inventory:transfer', 'Transfer inventory'),
  define('inventory:repack', 'Repack inventory'),

  define('warehouses:read', 'View warehouses'),
  define('warehouses:create', 'Create warehouses'),
  define('warehouses:update', 'Update warehouses'),
  define('warehouses:delete', 'Delete warehouses'),

  define('parties:read', 'View business partners'),
  define('parties:write', 'Manage business partners'),
  define('parties:import', 'Import business partners'),
  define('parties:export', 'Export business partners'),

  define('procurement:read', 'View procurement'),
  define('procurement:create', 'Create purchase orders'),
  define('procurement:update', 'Edit purchase orders'),
  define('procurement:submit', 'Submit purchase orders for approval'),
  define('procurement:approve', 'Approve procurement documents'),
  define('procurement:receive', 'Receive goods against purchase orders'),
  define('procurement:return', 'Return purchased goods'),
  define('procurement:invoice', 'Manage purchase invoices'),
  define('procurement:cancel', 'Cancel procurement documents'),

  define('campaigns:read', 'View campaigns'),
  define('campaigns:create', 'Create campaigns'),
  define('campaigns:update', 'Update campaigns'),
  define('campaigns:delete', 'Delete campaigns'),

  define('production:read', 'View production'),
  define('production:create', 'Create production records'),
  define('production:update', 'Update production records'),

  define('reports:view', 'View reports'),
  define('transactions:approve', 'Approve transactions'),
];

export const ALL_PERMISSION_KEYS = Object.freeze(
  PERMISSION_CATALOG.map(({ key }) => key),
);

const byPrefix = (...prefixes) =>
  ALL_PERMISSION_KEYS.filter((key) => prefixes.some((prefix) => key.startsWith(prefix)));

const without = (keys, denied) => keys.filter((key) => !denied.includes(key));

export const DEFAULT_ROLE_TEMPLATES = Object.freeze([
  {
    key: 'owner',
    name: 'Owner',
    description: 'Workspace owner with unrestricted access.',
    rank: 100,
    isSystem: true,
    isOwner: true,
    permissions: ALL_PERMISSION_KEYS,
  },
  {
    key: 'admin',
    name: 'Administrator',
    description: 'Company administrator without ownership transfer authority.',
    rank: 90,
    isSystem: true,
    permissions: without(ALL_PERMISSION_KEYS, ['companies:delete']),
  },
  {
    key: 'manager',
    name: 'Manager',
    description: 'Operational manager with member and master-data access.',
    rank: 70,
    isSystem: true,
    permissions: [
      'dashboard:read',
      'settings:read',
      'manufacturing:read',
      'crm:read',
      'warehouse:read',
      ...byPrefix('items:', 'inventory:', 'warehouses:', 'parties:', 'procurement:', 'campaigns:', 'production:'),
      'users:read',
      'users:invite:read',
      'users:invite:create',
      'users:invite:resend',
      'users:invite:revoke',
      'reports:view',
    ],
  },
  {
    key: 'production_manager',
    name: 'Production Manager',
    description: 'Manufacturing, batch, item and inventory operations.',
    rank: 60,
    isSystem: true,
    permissions: [
      'dashboard:read',
      'manufacturing:read',
      'warehouse:read',
      ...byPrefix('items:', 'inventory:', 'warehouses:', 'campaigns:', 'production:'),
      'parties:read',
      'procurement:read',
      'procurement:create',
      'procurement:update',
      'procurement:submit',
      'reports:view',
    ],
  },
  {
    key: 'store_operator',
    name: 'Store Operator',
    description: 'Warehouse and inventory operations.',
    rank: 50,
    isSystem: true,
    permissions: [
      'dashboard:read',
      'warehouse:read',
      'items:read',
      ...byPrefix('inventory:', 'warehouses:'),
      'parties:read',
      'procurement:read',
      'procurement:receive',
      'procurement:return',
    ],
  },
  {
    key: 'accountant',
    name: 'Accountant',
    description: 'Business-partner, reporting and transaction access.',
    rank: 50,
    isSystem: true,
    permissions: [
      'dashboard:read',
      'crm:read',
      'items:read',
      'inventory:read',
      ...byPrefix('parties:'),
      'procurement:read',
      'procurement:invoice',
      'procurement:approve',
      'reports:view',
      'transactions:approve',
    ],
  },
  {
    key: 'employee',
    name: 'Employee',
    description: 'Standard operational access.',
    rank: 30,
    isSystem: true,
    permissions: ['dashboard:read', 'items:read', 'inventory:read', 'parties:read', 'procurement:read'],
  },
  {
    key: 'viewer',
    name: 'Viewer',
    description: 'Read-only workspace access.',
    rank: 10,
    isSystem: true,
    permissions: ['dashboard:read', 'items:read', 'inventory:read', 'parties:read', 'procurement:read', 'reports:view'],
  },
]);

export function normalizeRoleKey(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}
