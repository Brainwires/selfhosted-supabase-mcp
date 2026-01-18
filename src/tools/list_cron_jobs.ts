/**
 * list_cron_jobs - Lists all scheduled cron jobs from pg_cron extension.
 *
 * Requires the pg_cron extension to be installed.
 * Users can only see their own jobs due to RLS unless using service role.
 */

import { z } from 'zod';
import { handleSqlResponse, executeSqlWithFallback } from './utils.js';
import type { ToolContext } from './types.js';

const CronJobSchema = z.object({
    jobid: z.number(),
    jobname: z.string().nullable(),
    schedule: z.string(),
    command: z.string(),
    database: z.string(),
    username: z.string(),
    active: z.boolean(),
    nodename: z.string(),
    nodeport: z.number(),
});

const ListCronJobsOutputSchema = z.array(CronJobSchema);

const ListCronJobsInputSchema = z.object({
    active_only: z.boolean().optional().describe('Only show active (enabled) jobs.'),
});

type ListCronJobsInput = z.infer<typeof ListCronJobsInputSchema>;

const mcpInputSchema = {
    type: 'object',
    properties: {
        active_only: {
            type: 'boolean',
            description: 'Only show active (enabled) jobs.',
        },
    },
    required: [],
};

export const listCronJobsTool = {
    name: 'list_cron_jobs',
    description: 'Lists all scheduled cron jobs from pg_cron extension. Requires pg_cron to be installed.',
    inputSchema: ListCronJobsInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: ListCronJobsOutputSchema,

    execute: async (input: ListCronJobsInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { active_only } = input;

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

        // Query cron jobs
        let listJobsSql = `
            SELECT
                jobid,
                jobname,
                schedule,
                command,
                database,
                username,
                active,
                nodename,
                nodeport
            FROM cron.job
        `;

        if (active_only) {
            listJobsSql += ' WHERE active = true';
        }

        listJobsSql += ' ORDER BY jobid';

        const result = await executeSqlWithFallback(client, listJobsSql, true);
        return handleSqlResponse(result, ListCronJobsOutputSchema);
    },
};
