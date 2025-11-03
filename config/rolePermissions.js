export const rolePermissions = {
  owner: [
    'company:full',
    'users:manage',
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
  ],
  admin: [
    'users:manage','items:full','inventory:full','reports:view'
  ],
  manager: [
    'items:read','items:update','inventory:read','inventory:issue'
  ],
  employee: [
    'items:read','inventory:read'
  ],
  store_operator: [
    'items:read','items:status:update','inventory:receive','inventory:issue'
  ],
  production_manager: [
    'items:read','inventory:read','inventory:transfer'
  ],
  accountant: [
    'reports:view','transactions:approve'
  ],
  viewer: [
    'items:read','inventory:read'
  ]
};