// backend-api/config/rolePermissions.js
export const rolePermissions = {
  owner: [
    'companies:full',
    'users:full',
    'items:full',
    'inventory:full',
    'settings:full',
    'categories:full',
    'parameters:full',
    'producttypes:full',
    'campaigns:full',
    'rawmaterials:full',
    'rawmterials:full',
    'batches:full',
    'parties:full',
    'dashboard:full',
    'manufacturing:full',
    'crm:full',
    'warehouses:full',
  ],
  manager: [
    'items:read','items:create','items:update', 'items:status:update',
    'inventory:read', 'inventory:receipt', 'inventory:repack',
    'users:invite:read', 'users:read', 'users:invite:create', 'users:invite:resend', 'users:invite:revoke','users:remove', 
    'warehouses:read', 'warehouses:update', 'warehouses:create', 'warehouses:delete'
  ],
  store_operator: [
    'items:read', 'items:create', 'items:update', 
    'inventory:read', 'inventory:receipt', 'inventory:issue','inventory:adjust', 'inventory:repack',
    'users:invite:read','users:invite:resend',
    'warehouses:read', 'warehouses:update', 'warehouses:create', 'warehouses:delete'
  ],
  production_manager: [
    'items:read','items:create','items:update', 
    'inventory:read', 'inventory:receipt', 'inventory:repack','inventory:adjust',
    'warehouses:read', 'warehouses:update', 'warehouses:create', 'warehouses:delete'
  ],
  accountant: [
    'reports:view','transactions:approve', 'inventory:issue', 
  ],
  investor: [
    'items:read','inventory:read', 'users:read'
  ],
};