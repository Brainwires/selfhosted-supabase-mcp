import { z } from 'zod';
import type { ToolContext } from './types.js';
import type { PoolClient } from 'pg';

/**
 * Analyzes migration SQL to detect potentially dangerous operations
 */
function analyzeMigrationSql(sql: string): { warnings: string[]; hasDestructive: boolean } {
    const warnings: string[] = [];
    let hasDestructive = false;
    const normalizedSql = sql.toUpperCase();

    if (/\bDROP\s+TABLE\b/.test(normalizedSql)) {
        warnings.push('DROP TABLE detected - this will permanently remove table data');
        hasDestructive = true;
    }
    if (/\bDROP\s+COLUMN\b/.test(normalizedSql) || /\bALTER\s+TABLE\b.*\bDROP\b/.test(normalizedSql)) {
        warnings.push('DROP COLUMN detected - this will permanently remove column data');
        hasDestructive = true;
    }
    if (/\bTRUNCATE\b/.test(normalizedSql)) {
        warnings.push('TRUNCATE detected - this will remove all table data');
        hasDestructive = true;
    }
    if (/\bDELETE\s+FROM\b/.test(normalizedSql)) {
        warnings.push('DELETE FROM detected - this will remove data');
        hasDestructive = true;
    }
    if (/\bALTER\s+TYPE\b/.test(normalizedSql)) {
        warnings.push('ALTER TYPE detected - may cause data loss if narrowing type');
    }
    if (/\bCASCADE\b/.test(normalizedSql)) {
        warnings.push('CASCADE detected - dependent objects will also be affected');
        hasDestructive = true;
    }

    return { warnings, hasDestructive };
}

// Input schema with confirmation and dry-run options
const ApplyMigrationInputSchema = z.object({
    version: z.string().describe("The migration version string (e.g., '20240101120000')."),
    name: z.string().optional().describe("An optional descriptive name for the migration."),
    sql: z.string().describe("The SQL DDL content of the migration."),
    confirm: z.boolean().optional().default(false).describe(
        'Must be set to true to apply the migration. Without this, returns a dry-run analysis.'
    ),
    force_destructive: z.boolean().optional().default(false).describe(
        'Must be set to true if the migration contains destructive operations (DROP, TRUNCATE, etc.).'
    ),
});
type ApplyMigrationInput = z.infer<typeof ApplyMigrationInputSchema>;

// Output schema with analysis information
const ApplyMigrationOutputSchema = z.object({
    success: z.boolean(),
    version: z.string(),
    message: z.string().optional(),
    dry_run: z.boolean().optional(),
    analysis: z.object({
        warnings: z.array(z.string()),
        has_destructive: z.boolean(),
        statement_count: z.number(),
    }).optional(),
});

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        version: { type: 'string', description: "The migration version string (e.g., '20240101120000')." },
        name: { type: 'string', description: 'An optional descriptive name for the migration.' },
        sql: { type: 'string', description: 'The SQL DDL content of the migration.' },
        confirm: {
            type: 'boolean',
            default: false,
            description: 'Must be set to true to apply the migration. Without this, returns a dry-run analysis.',
        },
        force_destructive: {
            type: 'boolean',
            default: false,
            description: 'Must be set to true if the migration contains destructive operations (DROP, TRUNCATE, etc.).',
        },
    },
    required: ['version', 'sql'],
};

// The tool definition
export const applyMigrationTool = {
    name: 'apply_migration',
    description:
        'Applies a SQL migration script and records it in schema_migrations. ' +
        'Requires confirm=true to execute. Without confirm, performs a dry-run analysis showing warnings. ' +
        'Destructive operations (DROP, TRUNCATE) require force_destructive=true.',
    inputSchema: ApplyMigrationInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: ApplyMigrationOutputSchema,
    execute: async (input: ApplyMigrationInput, context: ToolContext) => {
        const client = context.selfhostedClient;

        // Analyze the migration SQL
        const analysis = analyzeMigrationSql(input.sql);
        const statementCount = input.sql.split(';').filter(s => s.trim().length > 0).length;

        // Ensure pg is configured and available
        if (!client.isPgAvailable()) {
            throw new Error('Direct database connection (DATABASE_URL) is required for applying migrations but is not configured or available.');
        }

        // Check if migration already exists
        const existingMigration = await client.executeTransactionWithPg(async (pgClient: PoolClient) => {
            const result = await pgClient.query(
                'SELECT version FROM supabase_migrations.schema_migrations WHERE version = $1',
                [input.version]
            );
            return result.rows.length > 0;
        });

        if (existingMigration) {
            return {
                success: false,
                version: input.version,
                message: `Migration ${input.version} has already been applied.`,
                dry_run: !input.confirm,
                analysis: {
                    warnings: analysis.warnings,
                    has_destructive: analysis.hasDestructive,
                    statement_count: statementCount,
                },
            };
        }

        // Dry run mode - just return analysis
        if (!input.confirm) {
            return {
                success: true,
                version: input.version,
                message: `Dry run: Migration ${input.version} analyzed. Set confirm=true to apply.${
                    analysis.hasDestructive ? ' WARNING: Contains destructive operations - will require force_destructive=true.' : ''
                }`,
                dry_run: true,
                analysis: {
                    warnings: analysis.warnings,
                    has_destructive: analysis.hasDestructive,
                    statement_count: statementCount,
                },
            };
        }

        // Check for destructive operations
        if (analysis.hasDestructive && !input.force_destructive) {
            throw new Error(
                `Migration contains destructive operations. Set force_destructive=true to proceed. ` +
                `Warnings: ${analysis.warnings.join('; ')}`
            );
        }

        try {
            await client.executeTransactionWithPg(async (pgClient: PoolClient) => {
                // 1. Execute the provided migration SQL
                console.error(`Executing migration SQL for version ${input.version}...`);
                await pgClient.query(input.sql);
                console.error('Migration SQL executed successfully.');

                // 2. Insert the record into the migrations table
                console.error(`Recording migration version ${input.version} in schema_migrations...`);
                await pgClient.query(
                    'INSERT INTO supabase_migrations.schema_migrations (version, name) ' +
                    'VALUES ($1, $2);',
                    [input.version, input.name ?? '']
                );
                console.error(`Migration version ${input.version} recorded.`);
            });

            context.log?.(`Migration ${input.version} applied${analysis.hasDestructive ? ' (contained destructive operations)' : ''}`, analysis.hasDestructive ? 'warn' : 'info');

            return {
                success: true,
                version: input.version,
                message: `Migration ${input.version} applied successfully.`,
                dry_run: false,
                analysis: {
                    warnings: analysis.warnings,
                    has_destructive: analysis.hasDestructive,
                    statement_count: statementCount,
                },
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`Failed to apply migration ${input.version}:`, errorMessage);
            throw new Error(`Failed to apply migration ${input.version}: ${errorMessage}`);
        }
    },
}; 