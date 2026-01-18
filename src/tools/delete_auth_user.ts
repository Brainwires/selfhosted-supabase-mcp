/**
 * delete_auth_user - Deletes or disables a user in auth.users table.
 *
 * Requires direct database connection (DATABASE_URL).
 * Supports soft delete (disable) via disable_instead parameter.
 */

import { z } from 'zod';
import type { ToolContext } from './types.js';
import type { PoolClient } from 'pg';

const UserPreviewSchema = z.object({
    id: z.string(),
    email: z.string().nullable(),
    created_at: z.string().nullable(),
    last_sign_in_at: z.string().nullable(),
});

const DeleteAuthUserInputSchema = z.object({
    user_id: z.string().uuid().describe('The UUID of the user to delete.'),
    confirm: z.boolean().optional().default(false).describe('Must be true to actually delete. Without this, returns a preview.'),
    disable_instead: z.boolean().optional().default(false).describe('If true, disables the user instead of permanently deleting them (soft delete).'),
});

type DeleteAuthUserInput = z.infer<typeof DeleteAuthUserInputSchema>;

const DeleteAuthUserOutputSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    action: z.enum(['preview', 'deleted', 'disabled']).optional(),
    user_preview: UserPreviewSchema.optional(),
});

const mcpInputSchema = {
    type: 'object',
    properties: {
        user_id: {
            type: 'string',
            format: 'uuid',
            description: 'The UUID of the user to delete.',
        },
        confirm: {
            type: 'boolean',
            default: false,
            description: 'Must be true to actually delete. Without this, returns a preview.',
        },
        disable_instead: {
            type: 'boolean',
            default: false,
            description: 'If true, disables the user instead of permanently deleting them (soft delete).',
        },
    },
    required: ['user_id'],
};

export const deleteAuthUserTool = {
    name: 'delete_auth_user',
    description: 'Deletes or disables a user in auth.users table. Requires confirm=true to execute. Use disable_instead=true for soft delete.',
    inputSchema: DeleteAuthUserInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: DeleteAuthUserOutputSchema,

    execute: async (input: DeleteAuthUserInput, context: ToolContext) => {
        const client = context.selfhostedClient;

        if (!client.isPgAvailable()) {
            throw new Error('Direct database connection (DATABASE_URL) is required for user administration.');
        }

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
                message: `User with ID ${user_id} not found.`,
            };
        }

        // If not confirmed, return preview
        if (!confirm) {
            return {
                success: true,
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
                message: `User ${user_id} (${userPreview.email}) has been permanently deleted.`,
                action: 'deleted' as const,
                user_preview: userPreview,
            };
        }
    },
};
