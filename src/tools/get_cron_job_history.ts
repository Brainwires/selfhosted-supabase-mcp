/**
 * get_cron_job_history - Gets execution history for pg_cron jobs.
 *
 * Requires the pg_cron extension to be installed.
 * Shows recent job runs with status and timing information.
 */

import { z } from 'zod';
import { handleSqlResponse, executeSqlWithFallback } from './utils.js';
import type { ToolContext } from './types.js';

const CronJobRunSchema = z.object({
    jobid: z.number(),
    jobname: z.string().nullable(),
    schedule: z.string(),
    runid: z.number().nullable(),
    status: z.string().nullable(),
    start_time: z.string().nullable(),
    end_time: z.string().nullable(),
    return_message: z.string().nullable(),
});

const GetCronJobHistoryOutputSchema = z.array(CronJobRunSchema);

const GetCronJobHistoryInputSchema = z.object({
    jobid: z.number().optional().describe('Filter by specific job ID.'),
    jobname: z.string().optional().describe('Filter by job name pattern.'),
    limit: z.number().optional().default(100).describe('Maximum number of records to return.'),
    status: z.enum(['succeeded', 'failed']).optional().describe('Filter by execution status.'),
});

type GetCronJobHistoryInput = z.infer<typeof GetCronJobHistoryInputSchema>;

const mcpInputSchema = {
    type: 'object',
    properties: {
        jobid: {
            type: 'number',
            description: 'Filter by specific job ID.',
        },
        jobname: {
            type: 'string',
            description: 'Filter by job name pattern.',
        },
        limit: {
            type: 'number',
            description: 'Maximum number of records to return.',
            default: 100,
        },
        status: {
            type: 'string',
            enum: ['succeeded', 'failed'],
            description: 'Filter by execution status.',
        },
    },
    required: [],
};

export const getCronJobHistoryTool = {
    name: 'get_cron_job_history',
    description: 'Gets execution history for pg_cron jobs including status and timing. Requires pg_cron to be installed.',
    inputSchema: GetCronJobHistoryInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: GetCronJobHistoryOutputSchema,

    execute: async (input: GetCronJobHistoryInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { jobid, jobname, limit = 100, status } = input;

        // First check if pg_cron extension is installed
        const checkExtensionSql = `
            SELECT EXISTS (
                SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
            ) as installed;
        `;

        const extensionCheck = await executeSqlWithFallback(client, checkExtensionSql, true);

        if (!extensionCheck || !Array.isArray(extensionCheck) || extensionCheck.length === 0) {
            throw new Error('Failed to check pg_cron extension status.');
        }

        if (!extensionCheck[0].installed) {
            throw new Error('pg_cron extension is not installed. Install it with: CREATE EXTENSION pg_cron;');
        }

        // Build query with filters
        const conditions: string[] = [];

        if (jobid !== undefined) {
            conditions.push(`j.jobid = ${jobid}`);
        }

        if (jobname) {
            // Escape single quotes for SQL safety
            const escapedName = jobname.replace(/'/g, "''");
            conditions.push(`j.jobname ILIKE '%${escapedName}%'`);
        }

        if (status) {
            conditions.push(`r.status = '${status}'`);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const historySql = `
            SELECT
                j.jobid,
                j.jobname,
                j.schedule,
                r.runid,
                r.status,
                r.start_time::text,
                r.end_time::text,
                r.return_message
            FROM cron.job j
            LEFT JOIN cron.job_run_details r ON j.jobid = r.jobid
            ${whereClause}
            ORDER BY r.start_time DESC NULLS LAST
            LIMIT ${Math.min(limit, 1000)}
        `;

        const result = await executeSqlWithFallback(client, historySql, true);
        return handleSqlResponse(result, GetCronJobHistoryOutputSchema);
    },
};
