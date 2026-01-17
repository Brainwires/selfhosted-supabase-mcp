import { z } from 'zod';
import type { ToolContext } from './types.js';

// Input schema
const DropRlsPolicyInputSchema = z.object({
    schema: z.string().default('public').describe('Schema name (defaults to public).'),
    table: z.string().describe('Table name the policy is on.'),
    policy_name: z.string().describe('Name of the policy to drop.'),
    if_exists: z.boolean().optional().default(true).describe('Do not throw error if policy does not exist.'),
    confirm: z.boolean().optional().default(false).describe('Must be true to execute. Without this, returns a preview.'),
});
type DropRlsPolicyInput = z.infer<typeof DropRlsPolicyInputSchema>;

// Output schema
const DropRlsPolicyOutputSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    action: z.enum(['preview', 'dropped', 'not_found']),
    policy_sql: z.string().optional(),
    policy_details: z.object({
        policy_name: z.string(),
        command: z.string(),
        policy_type: z.string(),
        using_expression: z.string().nullable(),
        with_check_expression: z.string().nullable(),
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
        table: {
            type: 'string',
            description: 'Table name the policy is on.',
        },
        policy_name: {
            type: 'string',
            description: 'Name of the policy to drop.',
        },
        if_exists: {
            type: 'boolean',
            default: true,
            description: 'Do not throw error if policy does not exist.',
        },
        confirm: {
            type: 'boolean',
            default: false,
            description: 'Must be true to execute. Without this, returns a preview.',
        },
    },
    required: ['table', 'policy_name'],
};

export const dropRlsPolicyTool = {
    name: 'drop_rls_policy',
    description: 'Drops an existing Row Level Security (RLS) policy from a table. Requires confirm=true to execute.',
    inputSchema: DropRlsPolicyInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: DropRlsPolicyOutputSchema,

    execute: async (input: DropRlsPolicyInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { schema, table, policy_name, if_exists, confirm } = input;

        if (!client.isPgAvailable()) {
            throw new Error('Direct database connection (DATABASE_URL) is required for DDL operations but is not configured or available.');
        }

        try {
            // First, check if the policy exists and get its details
            const policyDetails = await client.executeTransactionWithPg(async (pgClient) => {
                const result = await pgClient.query(
                    `SELECT
                        pol.polname AS policy_name,
                        CASE pol.polcmd
                            WHEN 'r' THEN 'SELECT'
                            WHEN 'a' THEN 'INSERT'
                            WHEN 'w' THEN 'UPDATE'
                            WHEN 'd' THEN 'DELETE'
                            WHEN '*' THEN 'ALL'
                            ELSE pol.polcmd::text
                        END AS command,
                        CASE pol.polpermissive
                            WHEN true THEN 'PERMISSIVE'
                            ELSE 'RESTRICTIVE'
                        END AS policy_type,
                        pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) AS using_expression,
                        pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check_expression
                    FROM pg_catalog.pg_policy pol
                    JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
                    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = $1 AND c.relname = $2 AND pol.polname = $3`,
                    [schema, table, policy_name]
                );
                return result.rows[0] || null;
            });

            // Build the DROP POLICY statement
            const dropSql = `DROP POLICY ${if_exists ? 'IF EXISTS ' : ''}"${policy_name}" ON "${schema}"."${table}"`;

            // If policy doesn't exist
            if (!policyDetails) {
                if (if_exists) {
                    return {
                        success: true,
                        message: `Policy "${policy_name}" does not exist on ${schema}.${table}. No action taken.`,
                        action: 'not_found' as const,
                        policy_sql: dropSql,
                    };
                } else {
                    return {
                        success: false,
                        message: `Policy "${policy_name}" not found on ${schema}.${table}.`,
                        action: 'not_found' as const,
                    };
                }
            }

            // If not confirmed, return preview
            if (!confirm) {
                return {
                    success: true,
                    message: `Preview: Will drop policy. Set confirm=true to execute.`,
                    action: 'preview' as const,
                    policy_sql: dropSql,
                    policy_details: policyDetails,
                };
            }

            // Execute the drop
            await client.executeTransactionWithPg(async (pgClient) => {
                await pgClient.query(dropSql);
            });

            context.log?.(`Dropped RLS policy "${policy_name}" from ${schema}.${table}`, 'warn');

            return {
                success: true,
                message: `Successfully dropped policy "${policy_name}" from ${schema}.${table}.`,
                action: 'dropped' as const,
                policy_sql: dropSql,
                policy_details: policyDetails,
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to drop policy "${policy_name}": ${errorMessage}`);
        }
    },
};
