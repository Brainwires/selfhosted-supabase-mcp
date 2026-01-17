import { z } from 'zod';
import type { ToolContext } from './types.js';
import type { PoolClient } from 'pg';

// Shared AuthUser schema
const AuthUserSchema = z.object({
    id: z.uuid(),
    email: z.email().nullable(),
    role: z.string().nullable(),
    created_at: z.string().nullable(),
    updated_at: z.string().nullable().optional(),
    last_sign_in_at: z.string().nullable(),
    raw_app_meta_data: z.record(z.string(), z.unknown()).nullable(),
    raw_user_meta_data: z.record(z.string(), z.unknown()).nullable(),
});

// Input schema with discriminated union based on operation
const UserAdminInputSchema = z.discriminatedUnion('operation', [
    // List operation
    z.object({
        operation: z.literal('list'),
        limit: z.number().int().positive().optional().default(50).describe('Max number of users to return'),
        offset: z.number().int().nonnegative().optional().default(0).describe('Number of users to skip'),
    }),
    // Get operation
    z.object({
        operation: z.literal('get'),
        user_id: z.uuid().describe('The UUID of the user to retrieve.'),
    }),
    // Create operation
    z.object({
        operation: z.literal('create'),
        email: z.email().describe('The email address for the new user.'),
        password: z.string().min(6).describe('Plain text password (min 6 chars). WARNING: Insecure.'),
        role: z.string().optional().default('authenticated').describe('User role.'),
        app_metadata: z.record(z.string(), z.unknown()).optional().describe('Optional app metadata.'),
        user_metadata: z.record(z.string(), z.unknown()).optional().describe('Optional user metadata.'),
    }),
    // Update operation
    z.object({
        operation: z.literal('update'),
        user_id: z.uuid().describe('The UUID of the user to update.'),
        email: z.email().optional().describe('New email address.'),
        password: z.string().min(6).optional().describe('New plain text password (min 6 chars). WARNING: Insecure.'),
        role: z.string().optional().describe('New role.'),
        app_metadata: z.record(z.string(), z.unknown()).optional().describe('New app metadata (will overwrite existing).'),
        user_metadata: z.record(z.string(), z.unknown()).optional().describe('New user metadata (will overwrite existing).'),
    }),
    // Delete operation
    z.object({
        operation: z.literal('delete'),
        user_id: z.uuid().describe('The UUID of the user to delete.'),
        confirm: z.boolean().optional().default(false).describe('Must be true to actually delete. Without this, returns a preview.'),
        disable_instead: z.boolean().optional().default(false).describe('If true, disables the user instead of permanently deleting them (soft delete).'),
    }),
]);
type UserAdminInput = z.infer<typeof UserAdminInputSchema>;

// Output schema - flexible to handle all operations
const UserAdminOutputSchema = z.object({
    success: z.boolean(),
    operation: z.enum(['list', 'get', 'create', 'update', 'delete']),
    message: z.string().optional(),
    user: AuthUserSchema.optional(),
    users: z.array(AuthUserSchema).optional(),
    action: z.enum(['preview', 'deleted', 'disabled']).optional(),
    user_preview: z.object({
        id: z.string(),
        email: z.string().nullable(),
        created_at: z.string().nullable(),
        last_sign_in_at: z.string().nullable(),
    }).optional(),
});

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        operation: {
            type: 'string',
            enum: ['list', 'get', 'create', 'update', 'delete'],
            description: 'The operation to perform on auth.users.',
        },
        user_id: {
            type: 'string',
            format: 'uuid',
            description: 'The UUID of the user (required for get, update, delete operations).',
        },
        email: {
            type: 'string',
            format: 'email',
            description: 'Email address (required for create, optional for update).',
        },
        password: {
            type: 'string',
            minLength: 6,
            description: 'Plain text password (required for create, optional for update). WARNING: Insecure.',
        },
        role: {
            type: 'string',
            description: 'User role (optional for create/update).',
        },
        app_metadata: {
            type: 'object',
            description: 'App metadata (optional for create/update).',
        },
        user_metadata: {
            type: 'object',
            description: 'User metadata (optional for create/update).',
        },
        limit: {
            type: 'number',
            default: 50,
            description: 'Max number of users to return (for list operation).',
        },
        offset: {
            type: 'number',
            default: 0,
            description: 'Number of users to skip (for list operation).',
        },
        confirm: {
            type: 'boolean',
            default: false,
            description: 'Must be true to actually delete a user (for delete operation).',
        },
        disable_instead: {
            type: 'boolean',
            default: false,
            description: 'If true, disables instead of deleting (for delete operation).',
        },
    },
    required: ['operation'],
};

export const userAdminTool = {
    name: 'user_admin',
    description: 'Manage users in auth.users table. Operations: list (paginated), get (by ID), create (with email/password), update (fields), delete (with confirm). Requires direct database connection.',
    inputSchema: UserAdminInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: UserAdminOutputSchema,

    execute: async (input: UserAdminInput, context: ToolContext) => {
        const client = context.selfhostedClient;

        if (!client.isPgAvailable()) {
            throw new Error('Direct database connection (DATABASE_URL) is required for user administration.');
        }

        switch (input.operation) {
            case 'list':
                return executeList(client, input, context);
            case 'get':
                return executeGet(client, input, context);
            case 'create':
                return executeCreate(client, input, context);
            case 'update':
                return executeUpdate(client, input, context);
            case 'delete':
                return executeDelete(client, input, context);
        }
    },
};

// List users
async function executeList(
    client: ToolContext['selfhostedClient'],
    input: Extract<UserAdminInput, { operation: 'list' }>,
    context: ToolContext
) {
    const { limit, offset } = input;

    const sql = `
        SELECT id, email, role, raw_app_meta_data, raw_user_meta_data,
               created_at::text, last_sign_in_at::text
        FROM auth.users
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
    `;

    const users = await client.executeTransactionWithPg(async (pgClient: PoolClient) => {
        const result = await pgClient.query(sql, [limit, offset]);
        return result.rows;
    });

    context.log(`Listed ${users.length} users.`);

    return {
        success: true,
        operation: 'list' as const,
        message: `Found ${users.length} user(s).`,
        users: z.array(AuthUserSchema).parse(users),
    };
}

// Get single user
async function executeGet(
    client: ToolContext['selfhostedClient'],
    input: Extract<UserAdminInput, { operation: 'get' }>,
    context: ToolContext
) {
    const { user_id } = input;

    const sql = `
        SELECT id, email, role, raw_app_meta_data, raw_user_meta_data,
               created_at::text, last_sign_in_at::text
        FROM auth.users
        WHERE id = $1
    `;

    const user = await client.executeTransactionWithPg(async (pgClient: PoolClient) => {
        const result = await pgClient.query(sql, [user_id]);
        if (result.rows.length === 0) {
            throw new Error(`User with ID ${user_id} not found.`);
        }
        return result.rows[0];
    });

    context.log(`Retrieved user ${user_id}.`);

    return {
        success: true,
        operation: 'get' as const,
        user: AuthUserSchema.parse(user),
    };
}

// Create user
async function executeCreate(
    client: ToolContext['selfhostedClient'],
    input: Extract<UserAdminInput, { operation: 'create' }>,
    context: ToolContext
) {
    const { email, password, role, app_metadata, user_metadata } = input;

    context.log(`Creating user ${email}...`, 'warn');

    const user = await client.executeTransactionWithPg(async (pgClient: PoolClient) => {
        // Verify pgcrypto is available
        try {
            await pgClient.query("SELECT crypt('test', gen_salt('bf'))");
        } catch {
            throw new Error('pgcrypto extension is required. Ensure it is enabled in the database.');
        }

        const sql = `
            INSERT INTO auth.users (
                instance_id, email, encrypted_password, role,
                raw_app_meta_data, raw_user_meta_data,
                aud, email_confirmed_at, confirmation_sent_at
            )
            VALUES (
                COALESCE(current_setting('app.instance_id', TRUE), '00000000-0000-0000-0000-000000000000')::uuid,
                $1, crypt($2, gen_salt('bf')), $3,
                $4::jsonb, $5::jsonb,
                'authenticated', now(), now()
            )
            RETURNING id, email, role, raw_app_meta_data, raw_user_meta_data,
                      created_at::text, last_sign_in_at::text
        `;

        const params = [
            email,
            password,
            role || 'authenticated',
            JSON.stringify(app_metadata || {}),
            JSON.stringify(user_metadata || {}),
        ];

        try {
            const result = await pgClient.query(sql, params);
            return result.rows[0];
        } catch (err: unknown) {
            if (typeof err === 'object' && err !== null && 'code' in err && err.code === '23505') {
                throw new Error(`User creation failed: Email '${email}' already exists.`);
            }
            throw err;
        }
    });

    context.log(`Created user ${email} with ID ${user.id}.`);

    return {
        success: true,
        operation: 'create' as const,
        message: `User ${email} created successfully.`,
        user: AuthUserSchema.parse(user),
    };
}

// Update user
async function executeUpdate(
    client: ToolContext['selfhostedClient'],
    input: Extract<UserAdminInput, { operation: 'update' }>,
    context: ToolContext
) {
    const { user_id, email, password, role, app_metadata, user_metadata } = input;

    // Check that at least one field is being updated
    if (!email && !password && !role && !app_metadata && !user_metadata) {
        throw new Error('At least one field to update (email, password, role, app_metadata, user_metadata) must be provided.');
    }

    context.log(`Updating user ${user_id}...`);

    const user = await client.executeTransactionWithPg(async (pgClient: PoolClient) => {
        // Check pgcrypto if password is being updated
        if (password) {
            try {
                await pgClient.query("SELECT crypt('test', gen_salt('bf'))");
            } catch {
                throw new Error('pgcrypto extension is required for password updates.');
            }
        }

        const updates: string[] = [];
        const params: (string | null)[] = [];
        let paramIndex = 1;

        if (email !== undefined) {
            updates.push(`email = $${paramIndex++}`);
            params.push(email);
        }
        if (password !== undefined) {
            updates.push(`encrypted_password = crypt($${paramIndex++}, gen_salt('bf'))`);
            params.push(password);
        }
        if (role !== undefined) {
            updates.push(`role = $${paramIndex++}`);
            params.push(role);
        }
        if (app_metadata !== undefined) {
            updates.push(`raw_app_meta_data = $${paramIndex++}::jsonb`);
            params.push(JSON.stringify(app_metadata));
        }
        if (user_metadata !== undefined) {
            updates.push(`raw_user_meta_data = $${paramIndex++}::jsonb`);
            params.push(JSON.stringify(user_metadata));
        }

        params.push(user_id);
        const userIdParamIndex = paramIndex;

        const sql = `
            UPDATE auth.users
            SET ${updates.join(', ')}, updated_at = NOW()
            WHERE id = $${userIdParamIndex}
            RETURNING id, email, role, raw_app_meta_data, raw_user_meta_data,
                      created_at::text, updated_at::text, last_sign_in_at::text
        `;

        try {
            const result = await pgClient.query(sql, params);
            if (result.rows.length === 0) {
                throw new Error(`User with ID ${user_id} not found.`);
            }
            return result.rows[0];
        } catch (err: unknown) {
            if (typeof err === 'object' && err !== null && 'code' in err && err.code === '23505') {
                throw new Error(`Update failed: Email '${email}' already exists for another user.`);
            }
            throw err;
        }
    });

    context.log(`Updated user ${user_id}.`);

    return {
        success: true,
        operation: 'update' as const,
        message: `User ${user_id} updated successfully.`,
        user: AuthUserSchema.parse(user),
    };
}

// Delete user
async function executeDelete(
    client: ToolContext['selfhostedClient'],
    input: Extract<UserAdminInput, { operation: 'delete' }>,
    context: ToolContext
) {
    const { user_id, confirm, disable_instead } = input;

    // Fetch user preview
    const userPreview = await client.executeTransactionWithPg(async (pgClient: PoolClient) => {
        const result = await pgClient.query(
            `SELECT id, email, created_at::text, last_sign_in_at::text
             FROM auth.users WHERE id = $1`,
            [user_id]
        );
        return result.rows[0] || null;
    });

    if (!userPreview) {
        return {
            success: false,
            operation: 'delete' as const,
            message: `User with ID ${user_id} not found.`,
        };
    }

    // If not confirmed, return preview
    if (!confirm) {
        return {
            success: true,
            operation: 'delete' as const,
            message: `Preview: User found. Set confirm=true to ${disable_instead ? 'disable' : 'permanently delete'} this user.`,
            action: 'preview' as const,
            user_preview: userPreview,
        };
    }

    // Execute delete or disable
    if (disable_instead) {
        await client.executeTransactionWithPg(async (pgClient: PoolClient) => {
            await pgClient.query(
                `UPDATE auth.users
                 SET banned_until = '9999-12-31'::timestamp, updated_at = NOW()
                 WHERE id = $1`,
                [user_id]
            );
        });

        context.log(`User ${user_id} (${userPreview.email}) disabled.`, 'warn');

        return {
            success: true,
            operation: 'delete' as const,
            message: `User ${user_id} (${userPreview.email}) has been disabled.`,
            action: 'disabled' as const,
            user_preview: userPreview,
        };
    } else {
        await client.executeTransactionWithPg(async (pgClient: PoolClient) => {
            await pgClient.query('DELETE FROM auth.users WHERE id = $1', [user_id]);
        });

        context.log(`User ${user_id} (${userPreview.email}) permanently deleted.`, 'warn');

        return {
            success: true,
            operation: 'delete' as const,
            message: `User ${user_id} (${userPreview.email}) has been permanently deleted.`,
            action: 'deleted' as const,
            user_preview: userPreview,
        };
    }
}
