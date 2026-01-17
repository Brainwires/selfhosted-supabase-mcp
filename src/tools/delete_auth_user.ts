import { z } from 'zod';
import type { ToolContext } from './types.js';

// Input schema: User ID with confirmation and preview options
const DeleteAuthUserInputSchema = z.object({
    user_id: z.string().uuid().describe('The UUID of the user to delete.'),
    confirm: z.boolean().optional().default(false).describe(
        'Must be set to true to actually delete the user. Without this, returns a preview of the user to be deleted.'
    ),
    disable_instead: z.boolean().optional().default(false).describe(
        'If true, disables the user instead of permanently deleting them (soft delete). Safer option.'
    ),
});
type DeleteAuthUserInput = z.infer<typeof DeleteAuthUserInputSchema>;

// Output schema: Success status, message, and optional preview
const DeleteAuthUserOutputSchema = z.object({
    success: z.boolean(),
    message: z.string(),
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
        user_id: {
            type: 'string',
            format: 'uuid',
            description: 'The UUID of the user to delete.',
        },
        confirm: {
            type: 'boolean',
            default: false,
            description: 'Must be set to true to actually delete the user. Without this, returns a preview of the user to be deleted.',
        },
        disable_instead: {
            type: 'boolean',
            default: false,
            description: 'If true, disables the user instead of permanently deleting them (soft delete). Safer option.',
        },
    },
    required: ['user_id'],
};

// Tool definition
export const deleteAuthUserTool = {
    name: 'delete_auth_user',
    description:
        'Deletes a user from auth.users by their ID. Requires confirm=true to actually delete. ' +
        'Without confirm, returns a preview of the user. Use disable_instead=true for a safer soft-delete option.',
    inputSchema: DeleteAuthUserInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: DeleteAuthUserOutputSchema,

    execute: async (input: DeleteAuthUserInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { user_id, confirm, disable_instead } = input;

        if (!client.isPgAvailable()) {
            throw new Error('Direct database connection (DATABASE_URL) is required for deleting users but is not configured or available.');
        }

        try {
            // First, fetch the user to show preview or validate existence
            const userPreview = await client.executeTransactionWithPg(async (pgClient) => {
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
                    action: 'preview' as const,
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

            // Confirmed - execute the operation
            if (disable_instead) {
                // Soft delete - disable the user by setting banned_until far in the future
                await client.executeTransactionWithPg(async (pgClient) => {
                    await pgClient.query(
                        `UPDATE auth.users
                         SET banned_until = '9999-12-31'::timestamp,
                             updated_at = NOW()
                         WHERE id = $1`,
                        [user_id]
                    );
                });

                context.log?.(`User ${user_id} (${userPreview.email}) disabled`, 'warn');

                return {
                    success: true,
                    message: `User ${user_id} (${userPreview.email}) has been disabled. They can no longer sign in.`,
                    action: 'disabled' as const,
                    user_preview: userPreview,
                };
            } else {
                // Hard delete
                const result = await client.executeTransactionWithPg(async (pgClient) => {
                    const deleteResult = await pgClient.query(
                        'DELETE FROM auth.users WHERE id = $1',
                        [user_id]
                    );
                    return deleteResult;
                });

                context.log?.(`User ${user_id} (${userPreview.email}) permanently deleted`, 'warn');

                return {
                    success: true,
                    message: `User ${user_id} (${userPreview.email}) has been permanently deleted.`,
                    action: 'deleted' as const,
                    user_preview: userPreview,
                };
            }
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`Error deleting user ${user_id}:`, errorMessage);
            throw new Error(`Failed to delete user ${user_id}: ${errorMessage}`);
        }
    },
}; 