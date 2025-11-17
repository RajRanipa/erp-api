// permissionsController.js
import Permission from '../models/Permission.js';

// Utility: get allowed roles from schema enum
export function getAllowedRoles() {
    const schemaPath = Permission.schema.path('roles');
    // roles is an array of String with enum; caster holds the enum values
    const enumVals = schemaPath?.caster?.enumValues || schemaPath?.enumValues || [];
    return enumVals.length ? enumVals : [];
}

// GET /admin/permissions
// Query params: ?role=manager&q=read
export const listPermissions = async (req, res) => {
    try {
        const { role, q } = req.query || {};
        const filter = {};
        if (role) filter.roles = role;
        if (q) filter.$or = [{ key: new RegExp(q, 'i') }, { label: new RegExp(q, 'i') }];

        const permissions = await Permission.find(filter).sort({ key: 1 }).lean();
        return res.status(200).json({ status: true, permissions });
    } catch (err) {
        return res.status(500).json({ status: false, message: 'Failed to list permissions', error: err.message });
    }
};

// GET /admin/permissions/roles
export const listRoles = async (_req, res) => {
    try {
        const roles = getAllowedRoles();
        console.log('roles', roles);
        return res.status(200).json({ status: true, roles });
    } catch (err) {
        return res.status(500).json({ status: false, message: 'Failed to list roles', error: err.message });
    }
};

// GET /admin/permissions/role/:role
export const getRolePermissionsbyRole = async (req, res) => {
    try {
        const { role } = req.user;
        if (!role) return res.status(400).json({ status: false, message: 'Role is required' });

        const keys = await Permission.getKeysForRole(role);
        return res.status(200).json({ status: true, role, permissions: keys });
    } catch (err) {
        return res.status(500).json({ status: false, message: 'Failed to fetch role permissions', error: err.message });
    }
};

export const getRolePermissions = async (req, res) => {
    try {
        const { role } = req.params;
        if (!role) return res.status(400).json({ status: false, message: 'Role is required' });

        const keys = await Permission.getKeysForRole(role);
        return res.status(200).json({ status: true, role, permissions: keys });
    } catch (err) {
        return res.status(500).json({ status: false, message: 'Failed to fetch role permissions', error: err.message });
    }
};

// POST /admin/permissions/seed
// Body: { keys: ['items:read','inventory:issue'], labels?: { 'items:read': 'Read items' } }
export const seedPermissions = async (req, res) => {
    try {
        const { keys, labels } = req.body || {};
        if (!Array.isArray(keys) || !keys.length) {
            return res.status(400).json({ status: false, message: 'keys[] is required' });
        }

        const ops = keys.map((key) => ({
            updateOne: {
                filter: { key },
                update: { $setOnInsert: { key }, ...(labels?.[key] ? { $set: { label: labels[key] } } : {}) },
                upsert: true,
            },
        }));
        const result = await Permission.bulkWrite(ops, { ordered: false });
        return res.status(200).json({ status: true, message: 'Seed complete', result });
    } catch (err) {
        return res.status(500).json({ status: false, message: 'Failed to seed permissions', error: err.message });
    }
};

// POST /admin/permissions
// Body: { key: 'items:read', label?: 'Read items' }
export const createPermission = async (req, res) => {
    try {
        const { key, label } = req.body || {};
        if (!key) return res.status(400).json({ status: false, message: 'key is required' });

        const doc = await Permission.findOneAndUpdate(
            { key },
            { $setOnInsert: { key }, ...(label ? { $set: { label } } : {}) },
            { new: true, upsert: true }
        );
        return res.status(201).json({ status: true, data: doc });
    } catch (err) {
        return res.status(500).json({ status: false, message: 'Failed to create permission', error: err.message });
    }
};

// DELETE /admin/permissions/:key
export const deletePermission = async (req, res) => {
    try {
        const { key } = req.params;
        if (!key) return res.status(400).json({ status: false, message: 'key is required' });

        const result = await Permission.deleteOne({ key });
        return res.status(200).json({ status: true, data: result });
    } catch (err) {
        return res.status(500).json({ status: false, message: 'Failed to delete permission', error: err.message });
    }
};

// POST /admin/permissions/role/set
// Body: { role: 'manager', keys: ['items:read','inventory:receipt'] }
// Replaces the entire set for a role:
// 1) Pull role from all permissions
// 2) Add role to provided keys
export const setRolePermissions = async (req, res) => {
    try {
        const { role, keys } = req.body || {};
        if (!role) return res.status(400).json({ status: false, message: 'role is required' });
        if (!Array.isArray(keys)) return res.status(400).json({ status: false, message: 'keys[] must be an array' });

        const allowedRoles = getAllowedRoles();
        if (!allowedRoles.includes(role)) {
            return res.status(400).json({ status: false, message: `Invalid role: ${role}` });
        }
        
        const pullRes = await Permission.updateMany({ roles: role }, { $pull: { roles: role } });
        // console.log('allowedRoles', role, keys, pullRes);
        
        let addRes = { acknowledged: true, modifiedCount: 0, matchedCount: 0, upsertedCount: 0 };
        // console.log('keys.length', keys, keys.length);
        if (keys.length) {
            // console.log('keys.length true -', keys, keys.length);
            addRes = await Permission.updateMany({ key: { $in: keys } }, { $addToSet: { roles: role } });
            // console.log('addRes -', addRes);
        }

        // Return the new mapping
        const newKeys = await Permission.getKeysForRole(role);
        return res.status(200).json({
            status: true,
            message: 'Role permissions updated',
            role, assigned: newKeys, stats: { pulled: pullRes, added: addRes },
        });
    } catch (err) {
        return res.status(500).json({ status: false, message: 'Failed to set role permissions', error: err.message });
    }
};

// POST /admin/permissions/role/add
// Body: { role: 'manager', keys: ['items:read'] }
export const addRolePermissions = async (req, res) => {
    try {
        const { role, keys } = req.body || {};
        if (!role) return res.status(400).json({ status: false, message: 'role is required' });
        if (!Array.isArray(keys) || !keys.length) return res.status(400).json({ status: false, message: 'keys[] required' });

        const allowedRoles = getAllowedRoles();
        if (!allowedRoles.includes(role)) {
            return res.status(400).json({ status: false, message: `Invalid role: ${role}` });
        }

        const result = await Permission.updateMany({ key: { $in: keys } }, { $addToSet: { roles: role } });
        const newKeys = await Permission.getKeysForRole(role);
        return res.status(200).json({ status: true, message: 'Permissions added to role', data: { role, assigned: newKeys, stats: result } });
    } catch (err) {
        return res.status(500).json({ status: false, message: 'Failed to add role permissions', error: err.message });
    }
};

// POST /admin/permissions/role/remove
// Body: { role: 'manager', keys: ['items:read'] }
export const removeRolePermissions = async (req, res) => {
    try {
        const { role, keys } = req.body || {};
        if (!role) return res.status(400).json({ status: false, message: 'role is required' });
        if (!Array.isArray(keys) || !keys.length) return res.status(400).json({ status: false, message: 'keys[] required' });

        const allowedRoles = getAllowedRoles();
        if (!allowedRoles.includes(role)) {
            return res.status(400).json({ status: false, message: `Invalid role: ${role}` });
        }

        const result = await Permission.updateMany({ key: { $in: keys } }, { $pull: { roles: role } });
        const newKeys = await Permission.getKeysForRole(role);
        return res.status(200).json({ status: true, message: 'Permissions removed from role', data: { role, assigned: newKeys, stats: result } });
    } catch (err) {
        return res.status(500).json({ status: false, message: 'Failed to remove role permissions', error: err.message });
    }
};
