/**
 * update_auth_user - Updates an existing user in auth.users table.
 *
 * Requires direct database connection (DATABASE_URL).
 * Password updates require pgcrypto extension.
 */

import { z } from 'zod';
import type { ToolContext } from './types.js';
import type { PoolClient } from 'pg';

const AuthUserSchema = z.object({
    id: z.string().uuid(),
    email: z.string().email().nullable(),
    role: z.string().nullable(),
    created_at: z.string().nullable(),
    updated_at: z.string().nullable().optional(),
    last_sign_in_at: z.string().nullable(),
    raw_app_meta_data: z.record(z.string(), z.unknown()).nullable(),
    raw_user_meta_data: z.record(z.string(), z.unknown()).nullable(),
});

const UpdateAuthUserInputSchema = z.object({
    user_id: z.string().uuid().describe('The UUID of the user to update.'),
    email: z.string().email().optional().describe('New email address.'),
    password: z.string().min(6).optional().describe('New plain text password (min 6 chars). WARNING: Transmitted in plaintext.'),
    role: z.string().optional().describe('New role.'),
    app_metadata: z.record(z.string(), z.unknown()).optional().describe('New app metadata (will overwrite existing).'),
    user_metadata: z.record(z.string(), z.unknown()).optional().describe('New user metadata (will overwrite existing).'),
});

type UpdateAuthUserInput = z.infer<typeof UpdateAuthUserInputSchema>;

const UpdateAuthUserOutputSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    user: AuthUserSchema,
});

const mcpInputSchema = {
    type: 'object',
    properties: {
        user_id: {
            type: 'string',
            format: 'uuid',
            description: 'The UUID of the user to update.',
        },
        email: {
            type: 'string',
            format: 'email',
            description: 'New email address.',
        },
        password: {
            type: 'string',
            minLength: 6,
            description: 'New plain text password (min 6 chars). WARNING: Transmitted in plaintext.',
        },
        role: {
            type: 'string',
            description: 'New role.',
        },
        app_metadata: {
            type: 'object',
            description: 'New app metadata (will overwrite existing).',
        },
        user_metadata: {
            type: 'object',
            description: 'New user metadata (will overwrite existing).',
        },
    },
    required: ['user_id'],
};

export const updateAuthUserTool = {
    name: 'update_auth_user',
    description: 'Updates an existing user in auth.users table. At least one field to update must be provided. Requires direct database connection.',
    inputSchema: UpdateAuthUserInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: UpdateAuthUserOutputSchema,

    execute: async (input: UpdateAuthUserInput, context: ToolContext) => {
        const client = context.selfhostedClient;

        if (!client.isPgAvailable()) {
            throw new Error('Direct database connection (DATABASE_URL) is required for user administration.');
        }

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
            message: `User ${user_id} updated successfully.`,
            user: AuthUserSchema.parse(user),
        };
    },
};
