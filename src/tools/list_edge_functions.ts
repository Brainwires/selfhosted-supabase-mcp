/**
 * list_edge_functions - Lists edge functions from a metadata tracking table.
 *
 * IMPORTANT: This tool requires users to set up a tracking table in their database.
 * Edge functions in self-hosted Supabase are filesystem-based, so this tool reads
 * from a user-created metadata table rather than discovering functions automatically.
 *
 * Setup SQL:
 * CREATE TABLE public.edge_functions_metadata (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   slug TEXT UNIQUE NOT NULL,
 *   name TEXT NOT NULL,
 *   description TEXT,
 *   status TEXT DEFAULT 'deployed',
 *   created_at TIMESTAMPTZ DEFAULT NOW(),
 *   updated_at TIMESTAMPTZ DEFAULT NOW(),
 *   version TEXT DEFAULT '1.0.0'
 * );
 */

import { z } from 'zod';
import { handleSqlResponse, executeSqlWithFallback } from './utils.js';
import type { ToolContext } from './types.js';

const EdgeFunctionSchema = z.object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    status: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    version: z.string().nullable(),
});

const ListEdgeFunctionsOutputSchema = z.array(EdgeFunctionSchema);

const ListEdgeFunctionsInputSchema = z.object({
    status: z.string().optional().describe('Filter by status (e.g., "deployed", "pending").'),
});

type ListEdgeFunctionsInput = z.infer<typeof ListEdgeFunctionsInputSchema>;

const mcpInputSchema = {
    type: 'object',
    properties: {
        status: {
            type: 'string',
            description: 'Filter by status (e.g., "deployed", "pending").',
        },
    },
    required: [],
};

export const listEdgeFunctionsTool = {
    name: 'list_edge_functions',
    description: 'Lists edge functions from the metadata tracking table. Requires setup of public.edge_functions_metadata table.',
    inputSchema: ListEdgeFunctionsInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: ListEdgeFunctionsOutputSchema,

    execute: async (input: ListEdgeFunctionsInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { status } = input;

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
                'Edge functions metadata table not found. Please create it with:\n\n' +
                'CREATE TABLE public.edge_functions_metadata (\n' +
                '  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n' +
                '  slug TEXT UNIQUE NOT NULL,\n' +
                '  name TEXT NOT NULL,\n' +
                '  description TEXT,\n' +
                '  status TEXT DEFAULT \'deployed\',\n' +
                '  created_at TIMESTAMPTZ DEFAULT NOW(),\n' +
                '  updated_at TIMESTAMPTZ DEFAULT NOW(),\n' +
                '  version TEXT DEFAULT \'1.0.0\'\n' +
                ');'
            );
        }

        // Query edge functions
        let listFunctionsSql = `
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
        `;

        if (status) {
            const escapedStatus = status.replace(/'/g, "''");
            listFunctionsSql += ` WHERE status = '${escapedStatus}'`;
        }

        listFunctionsSql += ' ORDER BY created_at DESC';

        const result = await executeSqlWithFallback(client, listFunctionsSql, true);
        return handleSqlResponse(result, ListEdgeFunctionsOutputSchema);
    },
};
