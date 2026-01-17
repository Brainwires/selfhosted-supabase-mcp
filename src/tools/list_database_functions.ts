import { z } from 'zod';
import type { ToolContext } from './types.js';
import { handleSqlResponse, executeSqlWithFallback } from './utils.js';

// Output schema for database functions
const ListDatabaseFunctionsOutputSchema = z.array(z.object({
    schema_name: z.string(),
    function_name: z.string(),
    arguments: z.string(),
    return_type: z.string(),
    language: z.string(),
    volatility: z.string(), // IMMUTABLE, STABLE, or VOLATILE
    security_definer: z.boolean(),
    description: z.string().nullable(),
}));

// Input schema with optional filters
const ListDatabaseFunctionsInputSchema = z.object({
    schema: z.string().optional().describe('Filter functions by schema name.'),
    name_pattern: z.string().optional().describe('Filter functions by name pattern (SQL LIKE pattern).'),
    language: z.string().optional().describe('Filter by language (e.g., plpgsql, sql).'),
});
type ListDatabaseFunctionsInput = z.infer<typeof ListDatabaseFunctionsInputSchema>;

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        schema: {
            type: 'string',
            description: 'Filter functions by schema name.',
        },
        name_pattern: {
            type: 'string',
            description: 'Filter functions by name pattern (SQL LIKE pattern).',
        },
        language: {
            type: 'string',
            description: 'Filter by language (e.g., plpgsql, sql).',
        },
    },
    required: [],
};

export const listDatabaseFunctionsTool = {
    name: 'list_database_functions',
    description: 'Lists all user-defined database functions (stored procedures). Can filter by schema, name pattern, or language.',
    inputSchema: ListDatabaseFunctionsInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: ListDatabaseFunctionsOutputSchema,

    execute: async (input: ListDatabaseFunctionsInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { schema, name_pattern, language } = input;

        // Build WHERE conditions
        const conditions: string[] = [
            "n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')",
            "n.nspname NOT LIKE 'pg_temp_%'",
            "p.prokind = 'f'", // Functions only, not procedures or aggregates
        ];

        if (schema) {
            conditions.push(`n.nspname = '${schema.replace(/'/g, "''")}'`);
        }
        if (name_pattern) {
            conditions.push(`p.proname LIKE '${name_pattern.replace(/'/g, "''")}'`);
        }
        if (language) {
            conditions.push(`l.lanname = '${language.replace(/'/g, "''")}'`);
        }

        const whereClause = conditions.join(' AND ');

        const sql = `
            SELECT
                n.nspname AS schema_name,
                p.proname AS function_name,
                pg_catalog.pg_get_function_arguments(p.oid) AS arguments,
                pg_catalog.pg_get_function_result(p.oid) AS return_type,
                l.lanname AS language,
                CASE p.provolatile
                    WHEN 'i' THEN 'IMMUTABLE'
                    WHEN 's' THEN 'STABLE'
                    WHEN 'v' THEN 'VOLATILE'
                    ELSE p.provolatile::text
                END AS volatility,
                p.prosecdef AS security_definer,
                obj_description(p.oid, 'pg_proc') AS description
            FROM pg_catalog.pg_proc p
            JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
            JOIN pg_catalog.pg_language l ON l.oid = p.prolang
            WHERE ${whereClause}
            ORDER BY n.nspname, p.proname
        `;

        const result = await executeSqlWithFallback(client, sql, true);
        return handleSqlResponse(result, ListDatabaseFunctionsOutputSchema);
    },
};
