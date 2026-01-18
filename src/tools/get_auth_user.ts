/**
 * get_auth_user - Gets a single user by ID from auth.users table.
 *
 * Requires direct database connection (DATABASE_URL).
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

const GetAuthUserInputSchema = z.object({
    user_id: z.string().uuid().describe('The UUID of the user to retrieve.'),
});

type GetAuthUserInput = z.infer<typeof GetAuthUserInputSchema>;

const GetAuthUserOutputSchema = z.object({
    success: z.boolean(),
    user: AuthUserSchema,
});

const mcpInputSchema = {
    type: 'object',
    properties: {
        user_id: {
            type: 'string',
            format: 'uuid',
            description: 'The UUID of the user to retrieve.',
        },
    },
    required: ['user_id'],
};

export const getAuthUserTool = {
    name: 'get_auth_user',
    description: 'Gets a single user by ID from auth.users table. Requires direct database connection.',
    inputSchema: GetAuthUserInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: GetAuthUserOutputSchema,

    execute: async (input: GetAuthUserInput, context: ToolContext) => {
        const client = context.selfhostedClient;

        if (!client.isPgAvailable()) {
            throw new Error('Direct database connection (DATABASE_URL) is required for user administration.');
        }

        const { user_id } = input;

        const sql = `
            SELECT id, email, role, raw_app_meta_data, raw_user_meta_data,
                   created_at::text, updated_at::text, last_sign_in_at::text
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
            user: AuthUserSchema.parse(user),
        };
    },
};
