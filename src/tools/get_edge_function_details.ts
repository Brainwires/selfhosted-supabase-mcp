/**
 * get_edge_function_details - Gets details of a specific edge function including logs.
 *
 * Retrieves metadata from the user-created tracking table and execution logs
 * from the Supabase function_edge_logs table if available.
 */

import { z } from 'zod';
import { handleSqlResponse, executeSqlWithFallback } from './utils.js';
import type { ToolContext } from './types.js';

const EdgeFunctionDetailSchema = z.object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    status: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    version: z.string().nullable(),
});

const EdgeFunctionLogSchema = z.object({
    execution_id: z.string().nullable(),
    function_id: z.string().nullable(),
    status_code: z.number().nullable(),
    request_start_time: z.string().nullable(),
    request_duration_ms: z.number().nullable(),
    error_message: z.string().nullable(),
});

const GetEdgeFunctionDetailsOutputSchema = z.object({
    function: EdgeFunctionDetailSchema.nullable(),
    recent_logs: z.array(EdgeFunctionLogSchema),
    logs_available: z.boolean(),
});

const GetEdgeFunctionDetailsInputSchema = z.object({
    slug: z.string().describe('The edge function slug/ID to get details for.'),
    log_limit: z.number().optional().default(50).describe('Maximum number of log entries to return.'),
});

type GetEdgeFunctionDetailsInput = z.infer<typeof GetEdgeFunctionDetailsInputSchema>;

const mcpInputSchema = {
    type: 'object',
    properties: {
        slug: {
            type: 'string',
            description: 'The edge function slug/ID to get details for.',
        },
        log_limit: {
            type: 'number',
            description: 'Maximum number of log entries to return.',
            default: 50,
        },
    },
    required: ['slug'],
};

export const getEdgeFunctionDetailsTool = {
    name: 'get_edge_function_details',
    description: 'Gets details of a specific edge function including metadata and recent execution logs.',
    inputSchema: GetEdgeFunctionDetailsInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: GetEdgeFunctionDetailsOutputSchema,

    execute: async (input: GetEdgeFunctionDetailsInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { slug, log_limit = 50 } = input;

        const escapedSlug = slug.replace(/'/g, "''");

        // Check if the metadata table exists
        const checkTableSql = `
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = 'public'
                AND table_name = 'edge_functions_metadata'
            ) as exists;
        `;

        const tableCheck = await executeSqlWithFallback(client, checkTableSql, true);

        if (!tableCheck || !Array.isArray(tableCheck) || tableCheck.length === 0) {
            throw new Error('Failed to check for edge_functions_metadata table.');
        }

        if (!tableCheck[0].exists) {
            throw new Error(
                'Edge functions metadata table not found. See list_edge_functions for setup instructions.'
            );
        }

        // Get function metadata
        const functionSql = `
            SELECT
                id::text,
                slug,
                name,
                description,
                status,
                created_at::text,
                updated_at::text,
                version
            FROM public.edge_functions_metadata
            WHERE slug = '${escapedSlug}'
            LIMIT 1
        `;

        const functionResult = await executeSqlWithFallback(client, functionSql, true);
        const functionData = Array.isArray(functionResult) && functionResult.length > 0
            ? functionResult[0]
            : null;

        // Check if function_edge_logs table exists
        const checkLogTableSql = `
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.tables
                WHERE table_name = 'function_edge_logs'
            ) as exists;
        `;

        const logTableCheck = await executeSqlWithFallback(client, checkLogTableSql, true);
        const logsAvailable = Array.isArray(logTableCheck) && logTableCheck.length > 0 && logTableCheck[0].exists;

        let recentLogs: unknown[] = [];

        if (logsAvailable) {
            const logsSql = `
                SELECT
                    execution_id::text,
                    function_id,
                    status_code,
                    request_start_time::text,
                    EXTRACT(EPOCH FROM (request_end_time - request_start_time)) * 1000 as request_duration_ms,
                    error_message
                FROM function_edge_logs
                WHERE function_id = '${escapedSlug}'
                ORDER BY request_start_time DESC
                LIMIT ${Math.min(log_limit, 500)}
            `;

            try {
                const logsResult = await executeSqlWithFallback(client, logsSql, true);
                recentLogs = Array.isArray(logsResult) ? logsResult : [];
            } catch {
                // Log table might have different schema, silently fail
                recentLogs = [];
            }
        }

        return {
            function: functionData,
            recent_logs: recentLogs,
            logs_available: logsAvailable,
        };
    },
};
