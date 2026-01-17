import { z } from 'zod';
import type { ToolContext } from './types.js';

// Input schema
const DeleteStorageBucketInputSchema = z.object({
    bucket_id: z.string().describe('The ID/name of the bucket to delete.'),
    force: z.boolean().optional().default(false).describe('Delete bucket even if it contains objects (deletes all objects first).'),
    confirm: z.boolean().optional().default(false).describe('Must be true to execute. Without this, returns a preview.'),
});
type DeleteStorageBucketInput = z.infer<typeof DeleteStorageBucketInputSchema>;

// Output schema
const DeleteStorageBucketOutputSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    action: z.enum(['preview', 'deleted', 'not_found']),
    bucket_details: z.object({
        id: z.string(),
        name: z.string(),
        public: z.boolean(),
        object_count: z.number(),
        total_size_bytes: z.number().nullable(),
    }).optional(),
    objects_deleted: z.number().optional(),
});

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        bucket_id: {
            type: 'string',
            description: 'The ID/name of the bucket to delete.',
        },
        force: {
            type: 'boolean',
            default: false,
            description: 'Delete bucket even if it contains objects (deletes all objects first).',
        },
        confirm: {
            type: 'boolean',
            default: false,
            description: 'Must be true to execute. Without this, returns a preview.',
        },
    },
    required: ['bucket_id'],
};

export const deleteStorageBucketTool = {
    name: 'delete_storage_bucket',
    description: 'Deletes a storage bucket. Requires confirm=true to execute. Use force=true to delete non-empty buckets.',
    inputSchema: DeleteStorageBucketInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: DeleteStorageBucketOutputSchema,

    execute: async (input: DeleteStorageBucketInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { bucket_id, force, confirm } = input;

        if (!client.isPgAvailable()) {
            throw new Error('Direct database connection (DATABASE_URL) is required for deleting storage buckets but is not configured or available.');
        }

        try {
            // Get bucket details and object count
            const bucketDetails = await client.executeTransactionWithPg(async (pgClient) => {
                const bucketResult = await pgClient.query(
                    'SELECT id, name, public FROM storage.buckets WHERE id = $1',
                    [bucket_id]
                );

                if (bucketResult.rows.length === 0) {
                    return null;
                }

                const bucket = bucketResult.rows[0];

                // Get object count and total size
                const objectsResult = await pgClient.query(
                    `SELECT COUNT(*)::int AS object_count, SUM(metadata->>'size')::bigint AS total_size_bytes
                     FROM storage.objects WHERE bucket_id = $1`,
                    [bucket_id]
                );

                return {
                    id: bucket.id,
                    name: bucket.name,
                    public: bucket.public,
                    object_count: objectsResult.rows[0]?.object_count || 0,
                    total_size_bytes: objectsResult.rows[0]?.total_size_bytes || null,
                };
            });

            if (!bucketDetails) {
                return {
                    success: false,
                    message: `Bucket "${bucket_id}" not found.`,
                    action: 'not_found' as const,
                };
            }

            // Check if bucket has objects
            if (bucketDetails.object_count > 0 && !force) {
                return {
                    success: false,
                    message: `Bucket "${bucket_id}" contains ${bucketDetails.object_count} object(s). Use force=true to delete the bucket and all its contents.`,
                    action: 'preview' as const,
                    bucket_details: bucketDetails,
                };
            }

            // If not confirmed, return preview
            if (!confirm) {
                return {
                    success: true,
                    message: `Preview: Will delete bucket "${bucket_id}"${bucketDetails.object_count > 0 ? ` and ${bucketDetails.object_count} object(s)` : ''}. Set confirm=true to execute.`,
                    action: 'preview' as const,
                    bucket_details: bucketDetails,
                };
            }

            // Delete objects first if force is true
            let objectsDeleted = 0;
            if (bucketDetails.object_count > 0) {
                await client.executeTransactionWithPg(async (pgClient) => {
                    const deleteResult = await pgClient.query(
                        'DELETE FROM storage.objects WHERE bucket_id = $1',
                        [bucket_id]
                    );
                    objectsDeleted = deleteResult.rowCount || 0;
                });
            }

            // Delete the bucket
            await client.executeTransactionWithPg(async (pgClient) => {
                await pgClient.query(
                    'DELETE FROM storage.buckets WHERE id = $1',
                    [bucket_id]
                );
            });

            context.log?.(`Deleted storage bucket "${bucket_id}" (${objectsDeleted} objects deleted)`, 'warn');

            return {
                success: true,
                message: `Successfully deleted bucket "${bucket_id}"${objectsDeleted > 0 ? ` and ${objectsDeleted} object(s)` : ''}.`,
                action: 'deleted' as const,
                bucket_details: bucketDetails,
                objects_deleted: objectsDeleted,
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to delete bucket "${bucket_id}": ${errorMessage}`);
        }
    },
};
