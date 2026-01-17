import { z } from 'zod';
import type { ToolContext } from './types.js';
import { executeSqlWithFallback } from './utils.js';

// Input schema
const DropIndexInputSchema = z.object({
    schema: z.string().default('public').describe('Schema name (defaults to public).'),
    index_name: z.string().describe('Name of the index to drop.'),
    concurrently: z.boolean().optional().default(true).describe('Drop index without blocking concurrent operations.'),
    if_exists: z.boolean().optional().default(true).describe('Do not error if index does not exist.'),
    cascade: z.boolean().optional().default(false).describe('Also drop objects that depend on this index.'),
    confirm: z.boolean().optional().default(false).describe('Must be true to execute. Without this, returns a preview.'),
});
type DropIndexInput = z.infer<typeof DropIndexInputSchema>;

// Output schema
const DropIndexOutputSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    action: z.enum(['preview', 'dropped', 'not_found']),
    index_sql: z.string().optional(),
    index_details: z.object({
        schema_name: z.string(),
        table_name: z.string(),
        index_name: z.string(),
        index_type: z.string(),
        is_unique: z.boolean(),
        is_primary: z.boolean(),
        size: z.string(),
        definition: z.string(),
    }).optional(),
});

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        schema: {
            type: 'string',
            default: 'public',
            description: 'Schema name (defaults to public).',
        },
        index_name: {
            type: 'string',
            description: 'Name of the index to drop.',
        },
        concurrently: {
            type: 'boolean',
            default: true,
            description: 'Drop index without blocking concurrent operations.',
        },
        if_exists: {
            type: 'boolean',
            default: true,
            description: 'Do not error if index does not exist.',
        },
        cascade: {
            type: 'boolean',
            default: false,
            description: 'Also drop objects that depend on this index.',
        },
        confirm: {
            type: 'boolean',
            default: false,
            description: 'Must be true to execute. Without this, returns a preview.',
        },
    },
    required: ['index_name'],
};

export const dropIndexTool = {
    name: 'drop_index',
    description: 'Drops an existing index. Requires confirm=true to execute. Cannot drop primary key indexes directly.',
    inputSchema: DropIndexInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: DropIndexOutputSchema,

    execute: async (input: DropIndexInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { schema, index_name, concurrently, if_exists, cascade, confirm } = input;

        if (!client.isPgAvailable()) {
            throw new Error('Direct database connection (DATABASE_URL) is required for DDL operations but is not configured or available.');
        }

        // Build the DROP INDEX statement
        let dropSql = 'DROP INDEX';
        if (concurrently) dropSql += ' CONCURRENTLY';
        if (if_exists) dropSql += ' IF EXISTS';
        dropSql += ` "${schema}"."${index_name}"`;
        if (cascade) dropSql += ' CASCADE';

        try {
            // First, get index details
            const indexQuery = `
                SELECT
                    n.nspname AS schema_name,
                    t.relname AS table_name,
                    c.relname AS index_name,
                    am.amname AS index_type,
                    i.indisunique AS is_unique,
                    i.indisprimary AS is_primary,
                    pg_size_pretty(pg_relation_size(c.oid)) AS size,
                    pg_catalog.pg_get_indexdef(c.oid) AS definition
                FROM pg_catalog.pg_class c
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                JOIN pg_catalog.pg_index i ON i.indexrelid = c.oid
                JOIN pg_catalog.pg_class t ON t.oid = i.indrelid
                JOIN pg_catalog.pg_am am ON am.oid = c.relam
                WHERE n.nspname = '${schema.replace(/'/g, "''")}'
                  AND c.relname = '${index_name.replace(/'/g, "''")}'
                LIMIT 1
            `;

            const indexResult = await executeSqlWithFallback(client, indexQuery, true);
            const indexDetails = indexResult.success && (indexResult.data as unknown[]).length > 0
                ? (indexResult.data as unknown[])[0] as {
                    schema_name: string;
                    table_name: string;
                    index_name: string;
                    index_type: string;
                    is_unique: boolean;
                    is_primary: boolean;
                    size: string;
                    definition: string;
                }
                : null;

            // If index doesn't exist
            if (!indexDetails) {
                if (if_exists) {
                    return {
                        success: true,
                        message: `Index "${index_name}" does not exist in schema "${schema}". No action taken.`,
                        action: 'not_found' as const,
                        index_sql: dropSql,
                    };
                } else {
                    return {
                        success: false,
                        message: `Index "${index_name}" not found in schema "${schema}".`,
                        action: 'not_found' as const,
                    };
                }
            }

            // Check if it's a primary key index
            if (indexDetails.is_primary) {
                return {
                    success: false,
                    message: `Cannot drop index "${index_name}" because it is a primary key constraint. Use ALTER TABLE ... DROP CONSTRAINT instead.`,
                    action: 'preview' as const,
                    index_details: indexDetails,
                };
            }

            // If not confirmed, return preview
            if (!confirm) {
                return {
                    success: true,
                    message: `Preview: Will drop index. Set confirm=true to execute.`,
                    action: 'preview' as const,
                    index_sql: dropSql,
                    index_details: indexDetails,
                };
            }

            // Execute the drop
            // Note: CONCURRENTLY cannot be run inside a transaction
            if (concurrently) {
                const pool = await client.ensurePgPoolInitialized();
                if (!pool) {
                    throw new Error('PostgreSQL pool not available for CONCURRENT index drop.');
                }
                await pool.query(dropSql);
            } else {
                await client.executeTransactionWithPg(async (pgClient) => {
                    await pgClient.query(dropSql);
                });
            }

            context.log?.(`Dropped index "${index_name}" from ${schema}`, 'warn');

            return {
                success: true,
                message: `Successfully dropped index "${index_name}" from ${schema}.${indexDetails.table_name}.`,
                action: 'dropped' as const,
                index_sql: dropSql,
                index_details: indexDetails,
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to drop index "${index_name}": ${errorMessage}`);
        }
    },
};
