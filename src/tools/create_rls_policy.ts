import { z } from 'zod';
import type { ToolContext } from './types.js';

// Input schema
const CreateRlsPolicyInputSchema = z.object({
    schema: z.string().default('public').describe('Schema name (defaults to public).'),
    table: z.string().describe('Table name to create policy on.'),
    policy_name: z.string().describe('Name for the new policy.'),
    command: z.enum(['ALL', 'SELECT', 'INSERT', 'UPDATE', 'DELETE']).default('ALL').describe('SQL command the policy applies to.'),
    policy_type: z.enum(['PERMISSIVE', 'RESTRICTIVE']).default('PERMISSIVE').describe('Policy type (PERMISSIVE allows access, RESTRICTIVE restricts).'),
    roles: z.array(z.string()).optional().describe('Roles the policy applies to (defaults to PUBLIC).'),
    using_expression: z.string().optional().describe('USING clause for SELECT/UPDATE/DELETE (controls which rows are visible).'),
    with_check_expression: z.string().optional().describe('WITH CHECK clause for INSERT/UPDATE (controls which rows can be written).'),
    confirm: z.boolean().optional().default(false).describe('Must be true to execute. Without this, returns a preview.'),
});
type CreateRlsPolicyInput = z.infer<typeof CreateRlsPolicyInputSchema>;

// Output schema
const CreateRlsPolicyOutputSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    action: z.enum(['preview', 'created']),
    policy_sql: z.string().optional(),
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
            description: 'Table name to create policy on.',
        },
        policy_name: {
            type: 'string',
            description: 'Name for the new policy.',
        },
        command: {
            type: 'string',
            enum: ['ALL', 'SELECT', 'INSERT', 'UPDATE', 'DELETE'],
            default: 'ALL',
            description: 'SQL command the policy applies to.',
        },
        policy_type: {
            type: 'string',
            enum: ['PERMISSIVE', 'RESTRICTIVE'],
            default: 'PERMISSIVE',
            description: 'Policy type (PERMISSIVE allows access, RESTRICTIVE restricts).',
        },
        roles: {
            type: 'array',
            items: { type: 'string' },
            description: 'Roles the policy applies to (defaults to PUBLIC).',
        },
        using_expression: {
            type: 'string',
            description: 'USING clause for SELECT/UPDATE/DELETE (controls which rows are visible).',
        },
        with_check_expression: {
            type: 'string',
            description: 'WITH CHECK clause for INSERT/UPDATE (controls which rows can be written).',
        },
        confirm: {
            type: 'boolean',
            default: false,
            description: 'Must be true to execute. Without this, returns a preview.',
        },
    },
    required: ['table', 'policy_name'],
};

export const createRlsPolicyTool = {
    name: 'create_rls_policy',
    description: 'Creates a new Row Level Security (RLS) policy on a table. Requires confirm=true to execute.',
    inputSchema: CreateRlsPolicyInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: CreateRlsPolicyOutputSchema,

    execute: async (input: CreateRlsPolicyInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const {
            schema,
            table,
            policy_name,
            command,
            policy_type,
            roles,
            using_expression,
            with_check_expression,
            confirm
        } = input;

        if (!client.isPgAvailable()) {
            throw new Error('Direct database connection (DATABASE_URL) is required for DDL operations but is not configured or available.');
        }

        // Validate that at least one expression is provided
        if (!using_expression && !with_check_expression) {
            throw new Error('At least one of using_expression or with_check_expression must be provided.');
        }

        // Validate expression requirements based on command
        if (command === 'INSERT' && using_expression && !with_check_expression) {
            throw new Error('INSERT policies require WITH CHECK expression, not USING.');
        }

        // Build the CREATE POLICY statement
        const rolesList = roles && roles.length > 0
            ? roles.map(r => `"${r}"`).join(', ')
            : 'PUBLIC';

        let policySql = `CREATE POLICY "${policy_name}" ON "${schema}"."${table}"`;
        policySql += `\n    AS ${policy_type}`;
        policySql += `\n    FOR ${command}`;
        policySql += `\n    TO ${rolesList}`;

        if (using_expression) {
            policySql += `\n    USING (${using_expression})`;
        }

        if (with_check_expression) {
            policySql += `\n    WITH CHECK (${with_check_expression})`;
        }

        // If not confirmed, return preview
        if (!confirm) {
            return {
                success: true,
                message: `Preview: Will create policy. Set confirm=true to execute.`,
                action: 'preview' as const,
                policy_sql: policySql,
            };
        }

        try {
            // Check if table exists and RLS is enabled
            const tableCheck = await client.executeTransactionWithPg(async (pgClient) => {
                const result = await pgClient.query(
                    `SELECT c.relrowsecurity AS rls_enabled
                     FROM pg_catalog.pg_class c
                     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                     WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind = 'r'`,
                    [schema, table]
                );
                return result.rows[0] || null;
            });

            if (!tableCheck) {
                return {
                    success: false,
                    message: `Table ${schema}.${table} not found.`,
                    action: 'preview' as const,
                    policy_sql: policySql,
                };
            }

            if (!tableCheck.rls_enabled) {
                context.log?.(`Warning: RLS is not enabled on ${schema}.${table}. Policy will have no effect until RLS is enabled.`, 'warn');
            }

            // Execute the policy creation
            await client.executeTransactionWithPg(async (pgClient) => {
                await pgClient.query(policySql);
            });

            context.log?.(`Created RLS policy "${policy_name}" on ${schema}.${table}`, 'info');

            return {
                success: true,
                message: `Successfully created policy "${policy_name}" on ${schema}.${table}.${!tableCheck.rls_enabled ? ' Warning: RLS is not enabled on this table.' : ''}`,
                action: 'created' as const,
                policy_sql: policySql,
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to create policy "${policy_name}": ${errorMessage}`);
        }
    },
};
