import { z } from 'zod';
import type { ToolContext } from './types.js';

// Input schema
const CreateIndexInputSchema = z.object({
    schema: z.string().default('public').describe('Schema name (defaults to public).'),
    table: z.string().describe('Table name to create index on.'),
    index_name: z.string().describe('Name for the new index.'),
    columns: z.array(z.string()).min(1).describe('Column(s) to index.'),
    unique: z.boolean().optional().default(false).describe('Create a unique index.'),
    method: z.enum(['btree', 'hash', 'gist', 'gin', 'brin']).optional().default('btree').describe('Index method/type.'),
    where_clause: z.string().optional().describe('WHERE clause for partial index.'),
    include_columns: z.array(z.string()).optional().describe('Columns to include in covering index (INCLUDE clause).'),
    concurrently: z.boolean().optional().default(true).describe('Build index without locking writes (CONCURRENTLY).'),
    if_not_exists: z.boolean().optional().default(true).describe('Do not error if index already exists.'),
    confirm: z.boolean().optional().default(false).describe('Must be true to execute. Without this, returns a preview.'),
});
type CreateIndexInput = z.infer<typeof CreateIndexInputSchema>;

// Output schema
const CreateIndexOutputSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    action: z.enum(['preview', 'created']),
    index_sql: z.string(),
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
        table: {
            type: 'string',
            description: 'Table name to create index on.',
        },
        index_name: {
            type: 'string',
            description: 'Name for the new index.',
        },
        columns: {
            type: 'array',
            items: { type: 'string' },
            description: 'Column(s) to index.',
        },
        unique: {
            type: 'boolean',
            default: false,
            description: 'Create a unique index.',
        },
        method: {
            type: 'string',
            enum: ['btree', 'hash', 'gist', 'gin', 'brin'],
            default: 'btree',
            description: 'Index method/type.',
        },
        where_clause: {
            type: 'string',
            description: 'WHERE clause for partial index.',
        },
        include_columns: {
            type: 'array',
            items: { type: 'string' },
            description: 'Columns to include in covering index (INCLUDE clause).',
        },
        concurrently: {
            type: 'boolean',
            default: true,
            description: 'Build index without locking writes (CONCURRENTLY).',
        },
        if_not_exists: {
            type: 'boolean',
            default: true,
            description: 'Do not error if index already exists.',
        },
        confirm: {
            type: 'boolean',
            default: false,
            description: 'Must be true to execute. Without this, returns a preview.',
        },
    },
    required: ['table', 'index_name', 'columns'],
};

export const createIndexTool = {
    name: 'create_index',
    description: 'Creates a new index on a table. Supports various index types, partial indexes, and covering indexes. Requires confirm=true to execute.',
    inputSchema: CreateIndexInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: CreateIndexOutputSchema,

    execute: async (input: CreateIndexInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const {
            schema,
            table,
            index_name,
            columns,
            unique,
            method,
            where_clause,
            include_columns,
            concurrently,
            if_not_exists,
            confirm
        } = input;

        if (!client.isPgAvailable()) {
            throw new Error('Direct database connection (DATABASE_URL) is required for DDL operations but is not configured or available.');
        }

        // Build the CREATE INDEX statement
        let indexSql = 'CREATE';
        if (unique) indexSql += ' UNIQUE';
        indexSql += ' INDEX';
        if (concurrently) indexSql += ' CONCURRENTLY';
        if (if_not_exists) indexSql += ' IF NOT EXISTS';
        indexSql += ` "${index_name}"`;
        indexSql += ` ON "${schema}"."${table}"`;
        indexSql += ` USING ${method}`;
        indexSql += ` (${columns.map(c => `"${c}"`).join(', ')})`;

        if (include_columns && include_columns.length > 0) {
            indexSql += ` INCLUDE (${include_columns.map(c => `"${c}"`).join(', ')})`;
        }

        if (where_clause) {
            indexSql += ` WHERE ${where_clause}`;
        }

        // If not confirmed, return preview
        if (!confirm) {
            return {
                success: true,
                message: `Preview: Will create index. Set confirm=true to execute.`,
                action: 'preview' as const,
                index_sql: indexSql,
            };
        }

        try {
            // Check if table exists
            const tableCheck = await client.executeTransactionWithPg(async (pgClient) => {
                const result = await pgClient.query(
                    `SELECT 1 FROM pg_catalog.pg_class c
                     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                     WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind = 'r'`,
                    [schema, table]
                );
                return result.rows.length > 0;
            });

            if (!tableCheck) {
                return {
                    success: false,
                    message: `Table ${schema}.${table} not found.`,
                    action: 'preview' as const,
                    index_sql: indexSql,
                };
            }

            // Execute the index creation
            // Note: CONCURRENTLY cannot be run inside a transaction, so we use a different approach
            if (concurrently) {
                // For concurrent index creation, we need to run outside a transaction
                const pool = await client.ensurePgPoolInitialized();
                if (!pool) {
                    throw new Error('PostgreSQL pool not available for CONCURRENT index creation.');
                }
                await pool.query(indexSql);
            } else {
                await client.executeTransactionWithPg(async (pgClient) => {
                    await pgClient.query(indexSql);
                });
            }

            context.log?.(`Created index "${index_name}" on ${schema}.${table}`, 'info');

            return {
                success: true,
                message: `Successfully created index "${index_name}" on ${schema}.${table}.`,
                action: 'created' as const,
                index_sql: indexSql,
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to create index "${index_name}": ${errorMessage}`);
        }
    },
};
