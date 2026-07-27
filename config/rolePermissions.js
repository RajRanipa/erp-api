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
    'campaigns:full',
    'batches:full',
    'parties:full',
    'dashboard:full',
    'manufacturing:full',
    'crm:full',
    'warehouses:full',
  ],
  manager: [
    'items:read','items:create','items:update', 'items:status:update',
    'parameters:read','parameters:categories:read','parameters:producttypes:read',
    'parameters:densities:read','parameters:temperatures:read','parameters:dimensions:read',
    'inventory:read', 'inventory:receipt', 'inventory:transfer',
    'inventory:reserve', 'inventory:repack',
    'parties:read', 'parties:write', 'parties:import', 'parties:export',
    'users:invite:read', 'users:read', 'users:invite:create', 'users:invite:resend', 'users:invite:revoke','users:remove', 
    'warehouses:read', 'warehouses:update', 'warehouses:create', 'warehouses:delete'
  ],
  store_operator: [
    'items:read', 'items:create', 'items:update', 
    'parameters:read','parameters:categories:read','parameters:producttypes:read',
    'parameters:densities:read','parameters:temperatures:read','parameters:dimensions:read',
    'inventory:read', 'inventory:receipt', 'inventory:issue','inventory:adjust',
    'inventory:transfer', 'inventory:reserve', 'inventory:repack',
    'parties:read',
    'users:invite:read','users:invite:resend',
    'warehouses:read', 'warehouses:update', 'warehouses:create', 'warehouses:delete'
  ],
  production_manager: [
    'items:read','items:create','items:update', 
    'parameters:read','parameters:categories:read','parameters:producttypes:read',
    'parameters:densities:read','parameters:temperatures:read','parameters:dimensions:read',
    'inventory:read', 'inventory:receipt', 'inventory:repack','inventory:adjust',
    'inventory:transfer',
    'parties:read',
    'warehouses:read', 'warehouses:update', 'warehouses:create', 'warehouses:delete'
  ],
  accountant: [
    'reports:view','transactions:approve', 'inventory:issue',
    'parties:read', 'parties:write', 'parties:import', 'parties:export',
  ],
  investor: [
    'items:read','inventory:read', 'users:read', 'parties:read'
  ],
};
