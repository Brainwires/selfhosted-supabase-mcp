/**
 * list_auth_users - Lists users from auth.users table with pagination.
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
    last_sign_in_at: z.string().nullable(),
    raw_app_meta_data: z.record(z.string(), z.unknown()).nullable(),
    raw_user_meta_data: z.record(z.string(), z.unknown()).nullable(),
});

const ListAuthUsersInputSchema = z.object({
    limit: z.number().int().positive().optional().default(50).describe('Max number of users to return.'),
    offset: z.number().int().nonnegative().optional().default(0).describe('Number of users to skip.'),
});

type ListAuthUsersInput = z.infer<typeof ListAuthUsersInputSchema>;

const ListAuthUsersOutputSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    users: z.array(AuthUserSchema),
});

const mcpInputSchema = {
    type: 'object',
    properties: {
        limit: {
            type: 'number',
            default: 50,
            description: 'Max number of users to return.',
        },
        offset: {
            type: 'number',
            default: 0,
            description: 'Number of users to skip.',
        },
    },
    required: [],
};

export const listAuthUsersTool = {
    name: 'list_auth_users',
    description: 'Lists users from auth.users table with pagination. Requires direct database connection.',
    inputSchema: ListAuthUsersInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: ListAuthUsersOutputSchema,

    execute: async (input: ListAuthUsersInput, context: ToolContext) => {
        const client = context.selfhostedClient;

        if (!client.isPgAvailable()) {
            throw new Error('Direct database connection (DATABASE_URL) is required for user administration.');
        }

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
            message: `Found ${users.length} user(s).`,
            users: z.array(AuthUserSchema).parse(users),
        };
    },
};
