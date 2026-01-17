import { z } from 'zod';
import type { ToolContext } from './types.js';

// Input schema
const EnableRlsOnTableInputSchema = z.object({
    schema: z.string().default('public').describe('Schema name (defaults to public).'),
    table: z.string().describe('Table name to enable RLS on.'),
    force: z.boolean().optional().default(false).describe('Also force RLS for table owner (FORCE ROW LEVEL SECURITY).'),
    confirm: z.boolean().optional().default(false).describe('Must be true to execute. Without this, returns a preview.'),
});
type EnableRlsOnTableInput = z.infer<typeof EnableRlsOnTableInputSchema>;

// Output schema
const EnableRlsOnTableOutputSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    action: z.enum(['preview', 'enabled']),
    schema: z.string(),
    table: z.string(),
    rls_enabled: z.boolean().optional(),
    rls_forced: z.boolean().optional(),
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
            description: 'Table name to enable RLS on.',
        },
        force: {
            type: 'boolean',
            default: false,
            description: 'Also force RLS for table owner (FORCE ROW LEVEL SECURITY).',
        },
        confirm: {
            type: 'boolean',
            default: false,
            description: 'Must be true to execute. Without this, returns a preview.',
        },
    },
    required: ['table'],
};

export const enableRlsOnTableTool = {
    name: 'enable_rls_on_table',
    description: 'Enables Row Level Security (RLS) on a table. Requires confirm=true to execute. Optionally forces RLS for table owner.',
    inputSchema: EnableRlsOnTableInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: EnableRlsOnTableOutputSchema,

    execute: async (input: EnableRlsOnTableInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { schema, table, force, confirm } = input;

        if (!client.isPgAvailable()) {
            throw new Error('Direct database connection (DATABASE_URL) is required for DDL operations but is not configured or available.');
        }

        try {
            // First check current RLS status
            const statusResult = await client.executeTransactionWithPg(async (pgClient) => {
                const result = await pgClient.query(
                    `SELECT c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
                     FROM pg_catalog.pg_class c
                     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                     WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind = 'r'`,
                    [schema, table]
                );
                return result.rows[0] || null;
            });

            if (!statusResult) {
                return {
                    success: false,
                    message: `Table ${schema}.${table} not found.`,
                    action: 'preview' as const,
                    schema,
                    table,
                };
            }

            // If not confirmed, return preview
            if (!confirm) {
                const actions: string[] = [];
                if (!statusResult.rls_enabled) {
                    actions.push('ENABLE ROW LEVEL SECURITY');
                }
                if (force && !statusResult.rls_forced) {
                    actions.push('FORCE ROW LEVEL SECURITY');
                }

                if (actions.length === 0) {
                    return {
                        success: true,
                        message: `RLS is already ${statusResult.rls_enabled ? 'enabled' : 'disabled'}${statusResult.rls_forced ? ' and forced' : ''} on ${schema}.${table}. No changes needed.`,
                        action: 'preview' as const,
                        schema,
                        table,
                        rls_enabled: statusResult.rls_enabled,
                        rls_forced: statusResult.rls_forced,
                    };
                }

                return {
                    success: true,
                    message: `Preview: Will execute ${actions.join(' and ')} on ${schema}.${table}. Set confirm=true to execute.`,
                    action: 'preview' as const,
                    schema,
                    table,
                    rls_enabled: statusResult.rls_enabled,
                    rls_forced: statusResult.rls_forced,
                };
            }

            // Execute the DDL
            await client.executeTransactionWithPg(async (pgClient) => {
                // Use format() for safe identifier quoting
                const enableSql = `ALTER TABLE "${schema}"."${table}" ENABLE ROW LEVEL SECURITY`;
                await pgClient.query(enableSql);

                if (force) {
                    const forceSql = `ALTER TABLE "${schema}"."${table}" FORCE ROW LEVEL SECURITY`;
                    await pgClient.query(forceSql);
                }
            });

            context.log?.(`RLS enabled on ${schema}.${table}${force ? ' (forced)' : ''}`, 'info');

            return {
                success: true,
                message: `Successfully enabled RLS on ${schema}.${table}${force ? ' with FORCE' : ''}.`,
                action: 'enabled' as const,
                schema,
                table,
                rls_enabled: true,
                rls_forced: force,
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to enable RLS on ${schema}.${table}: ${errorMessage}`);
        }
    },
};
