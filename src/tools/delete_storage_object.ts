import { z } from 'zod';
import type { ToolContext } from './types.js';

// Input schema
const DeleteStorageObjectInputSchema = z.object({
    bucket_id: z.string().describe('The bucket ID containing the object.'),
    path: z.string().describe('The path/name of the object to delete.'),
    confirm: z.boolean().optional().default(false).describe('Must be true to execute. Without this, returns a preview.'),
});
type DeleteStorageObjectInput = z.infer<typeof DeleteStorageObjectInputSchema>;

// Output schema
const DeleteStorageObjectOutputSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    action: z.enum(['preview', 'deleted', 'not_found']),
    object_details: z.object({
        id: z.string(),
        bucket_id: z.string(),
        name: z.string(),
        size: z.number().nullable(),
        mime_type: z.string().nullable(),
        created_at: z.string(),
        updated_at: z.string(),
    }).optional(),
});

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        bucket_id: {
            type: 'string',
            description: 'The bucket ID containing the object.',
        },
        path: {
            type: 'string',
            description: 'The path/name of the object to delete.',
        },
        confirm: {
            type: 'boolean',
            default: false,
            description: 'Must be true to execute. Without this, returns a preview.',
        },
    },
    required: ['bucket_id', 'path'],
};

export const deleteStorageObjectTool = {
    name: 'delete_storage_object',
    description: 'Deletes a file/object from a storage bucket. Requires confirm=true to execute.',
    inputSchema: DeleteStorageObjectInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: DeleteStorageObjectOutputSchema,

    execute: async (input: DeleteStorageObjectInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { bucket_id, path, confirm } = input;

        if (!client.isPgAvailable()) {
            throw new Error('Direct database connection (DATABASE_URL) is required for deleting storage objects but is not configured or available.');
        }

        // In HTTP mode, restrict destructive storage operations to service_role
        if (context.authContext) {
            const role = context.authContext.role;
            if (role !== 'service_role') {
                context.log?.(`Storage object deletion attempted by user ${context.authContext.userId} (role: ${role}) - denied`, 'warn');
                throw new Error('Deleting storage objects via this tool requires service_role privileges. Use the Supabase Storage API with your JWT for user-level object deletion.');
            }
            context.log?.(`Storage object deletion initiated by ${context.authContext.userId} for ${bucket_id}/${path}`, 'info');
        }

        try {
            // Get object details
            const objectDetails = await client.executeTransactionWithPg(async (pgClient) => {
                const result = await pgClient.query(
                    `SELECT
                        id,
                        bucket_id,
                        name,
                        (metadata->>'size')::int AS size,
                        (metadata->>'mimetype') AS mime_type,
                        created_at::text,
                        updated_at::text
                    FROM storage.objects
                    WHERE bucket_id = $1 AND name = $2`,
                    [bucket_id, path]
                );
                return result.rows[0] || null;
            });

            if (!objectDetails) {
                return {
                    success: false,
                    message: `Object "${path}" not found in bucket "${bucket_id}".`,
                    action: 'not_found' as const,
                };
            }

            // If not confirmed, return preview
            if (!confirm) {
                return {
                    success: true,
                    message: `Preview: Will delete object "${path}" from bucket "${bucket_id}". Set confirm=true to execute.`,
                    action: 'preview' as const,
                    object_details: objectDetails,
                };
            }

            // Delete the object
            await client.executeTransactionWithPg(async (pgClient) => {
                await pgClient.query(
                    'DELETE FROM storage.objects WHERE bucket_id = $1 AND name = $2',
                    [bucket_id, path]
                );
            });

            context.log?.(`Deleted storage object "${path}" from bucket "${bucket_id}"`, 'warn');

            return {
                success: true,
                message: `Successfully deleted object "${path}" from bucket "${bucket_id}".`,
                action: 'deleted' as const,
                object_details: objectDetails,
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to delete object "${path}": ${errorMessage}`);
        }
    },
};
