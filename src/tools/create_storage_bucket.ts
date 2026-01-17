import { z } from 'zod';
import type { ToolContext } from './types.js';

// Input schema
const CreateStorageBucketInputSchema = z.object({
    name: z.string().min(3).describe('Bucket name (3+ characters, lowercase, hyphens allowed).'),
    public: z.boolean().optional().default(false).describe('Make bucket publicly accessible.'),
    file_size_limit: z.number().optional().describe('Maximum file size in bytes.'),
    allowed_mime_types: z.array(z.string()).optional().describe('Allowed MIME types (e.g., ["image/png", "image/jpeg"]).'),
    confirm: z.boolean().optional().default(false).describe('Must be true to execute. Without this, returns a preview.'),
});
type CreateStorageBucketInput = z.infer<typeof CreateStorageBucketInputSchema>;

// Output schema
const CreateStorageBucketOutputSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    action: z.enum(['preview', 'created']),
    bucket: z.object({
        name: z.string(),
        public: z.boolean(),
        file_size_limit: z.number().nullable(),
        allowed_mime_types: z.array(z.string()).nullable(),
    }).optional(),
});

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        name: {
            type: 'string',
            minLength: 3,
            description: 'Bucket name (3+ characters, lowercase, hyphens allowed).',
        },
        public: {
            type: 'boolean',
            default: false,
            description: 'Make bucket publicly accessible.',
        },
        file_size_limit: {
            type: 'number',
            description: 'Maximum file size in bytes.',
        },
        allowed_mime_types: {
            type: 'array',
            items: { type: 'string' },
            description: 'Allowed MIME types (e.g., ["image/png", "image/jpeg"]).',
        },
        confirm: {
            type: 'boolean',
            default: false,
            description: 'Must be true to execute. Without this, returns a preview.',
        },
    },
    required: ['name'],
};

export const createStorageBucketTool = {
    name: 'create_storage_bucket',
    description: 'Creates a new storage bucket. Requires confirm=true to execute.',
    inputSchema: CreateStorageBucketInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: CreateStorageBucketOutputSchema,

    execute: async (input: CreateStorageBucketInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { name, public: isPublic, file_size_limit, allowed_mime_types, confirm } = input;

        if (!client.isPgAvailable()) {
            throw new Error('Direct database connection (DATABASE_URL) is required for creating storage buckets but is not configured or available.');
        }

        // Validate bucket name format
        if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(name) && name.length >= 3) {
            // Allow simple names that are just lowercase letters/numbers
            if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]?$/.test(name)) {
                throw new Error('Bucket name must be lowercase, start with a letter or number, and can contain hyphens.');
            }
        }

        const bucketConfig = {
            name,
            public: isPublic,
            file_size_limit: file_size_limit || null,
            allowed_mime_types: allowed_mime_types || null,
        };

        // If not confirmed, return preview
        if (!confirm) {
            return {
                success: true,
                message: `Preview: Will create bucket "${name}". Set confirm=true to execute.`,
                action: 'preview' as const,
                bucket: bucketConfig,
            };
        }

        try {
            // Check if bucket already exists
            const existingBucket = await client.executeTransactionWithPg(async (pgClient) => {
                const result = await pgClient.query(
                    'SELECT id FROM storage.buckets WHERE name = $1',
                    [name]
                );
                return result.rows[0] || null;
            });

            if (existingBucket) {
                return {
                    success: false,
                    message: `Bucket "${name}" already exists.`,
                    action: 'preview' as const,
                };
            }

            // Create the bucket
            await client.executeTransactionWithPg(async (pgClient) => {
                await pgClient.query(
                    `INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types, created_at, updated_at)
                     VALUES ($1, $1, $2, $3, $4, NOW(), NOW())`,
                    [name, isPublic, file_size_limit || null, allowed_mime_types || null]
                );
            });

            context.log?.(`Created storage bucket "${name}"`, 'info');

            return {
                success: true,
                message: `Successfully created bucket "${name}".`,
                action: 'created' as const,
                bucket: bucketConfig,
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to create bucket "${name}": ${errorMessage}`);
        }
    },
};
