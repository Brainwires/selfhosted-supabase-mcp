/**
 * create_auth_user - Creates a new user in auth.users table.
 *
 * Requires direct database connection (DATABASE_URL) and pgcrypto extension.
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

const CreateAuthUserInputSchema = z.object({
    email: z.string().email().describe('The email address for the new user.'),
    password: z.string().min(6).describe('Plain text password (min 6 chars). WARNING: Transmitted in plaintext.'),
    role: z.string().optional().default('authenticated').describe('User role (default: authenticated).'),
    app_metadata: z.record(z.string(), z.unknown()).optional().describe('Optional app metadata.'),
    user_metadata: z.record(z.string(), z.unknown()).optional().describe('Optional user metadata.'),
});

type CreateAuthUserInput = z.infer<typeof CreateAuthUserInputSchema>;

const CreateAuthUserOutputSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    user: AuthUserSchema,
});

const mcpInputSchema = {
    type: 'object',
    properties: {
        email: {
            type: 'string',
            format: 'email',
            description: 'The email address for the new user.',
        },
        password: {
            type: 'string',
            minLength: 6,
            description: 'Plain text password (min 6 chars). WARNING: Transmitted in plaintext.',
        },
        role: {
            type: 'string',
            default: 'authenticated',
            description: 'User role (default: authenticated).',
        },
        app_metadata: {
            type: 'object',
            description: 'Optional app metadata.',
        },
        user_metadata: {
            type: 'object',
            description: 'Optional user metadata.',
        },
    },
    required: ['email', 'password'],
};

export const createAuthUserTool = {
    name: 'create_auth_user',
    description: 'Creates a new user in auth.users table with email and password. Requires direct database connection and pgcrypto extension.',
    inputSchema: CreateAuthUserInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: CreateAuthUserOutputSchema,

    execute: async (input: CreateAuthUserInput, context: ToolContext) => {
        const client = context.selfhostedClient;

        if (!client.isPgAvailable()) {
            throw new Error('Direct database connection (DATABASE_URL) is required for user administration.');
        }

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
            message: `User ${email} created successfully.`,
            user: AuthUserSchema.parse(user),
        };
    },
};
