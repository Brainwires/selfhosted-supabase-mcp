/**
 * list_vector_indexes - Lists all vector indexes (IVFFlat, HNSW) from pgvector extension.
 *
 * Requires the pgvector extension to be installed.
 * Parses index definitions to extract index type and parameters.
 */

import { z } from 'zod';
import { handleSqlResponse, executeSqlWithFallback } from './utils.js';
import type { ToolContext } from './types.js';

const VectorIndexSchema = z.object({
    schemaname: z.string(),
    tablename: z.string(),
    indexname: z.string(),
    index_type: z.string(),
    lists_param: z.number().nullable(),
    m_param: z.number().nullable(),
    ef_construction_param: z.number().nullable(),
    distance_operator: z.string().nullable(),
    indexdef: z.string(),
});

const ListVectorIndexesOutputSchema = z.array(VectorIndexSchema);

const ListVectorIndexesInputSchema = z.object({
    schema: z.string().optional().describe('Filter by schema name.'),
    table: z.string().optional().describe('Filter by table name.'),
    index_type: z.enum(['ivfflat', 'hnsw']).optional().describe('Filter by index type.'),
});

type ListVectorIndexesInput = z.infer<typeof ListVectorIndexesInputSchema>;

const mcpInputSchema = {
    type: 'object',
    properties: {
        schema: {
            type: 'string',
            description: 'Filter by schema name.',
        },
        table: {
            type: 'string',
            description: 'Filter by table name.',
        },
        index_type: {
            type: 'string',
            enum: ['ivfflat', 'hnsw'],
            description: 'Filter by index type.',
        },
    },
    required: [],
};

export const listVectorIndexesTool = {
    name: 'list_vector_indexes',
    description: 'Lists all vector indexes (IVFFlat, HNSW) from pgvector extension with their parameters.',
    inputSchema: ListVectorIndexesInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: ListVectorIndexesOutputSchema,

    execute: async (input: ListVectorIndexesInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { schema, table, index_type } = input;

        // First check if pgvector extension is installed
        const checkExtensionSql = `
            SELECT EXISTS (
                SELECT 1 FROM pg_extension WHERE extname = 'vector'
            ) as installed;
        `;

        const extensionCheck = await executeSqlWithFallback(client, checkExtensionSql, true);

        if (!extensionCheck || !Array.isArray(extensionCheck) || extensionCheck.length === 0) {
            throw new Error('Failed to check pgvector extension status.');
        }

        if (!extensionCheck[0].installed) {
            throw new Error('pgvector extension is not installed. Install it with: CREATE EXTENSION vector;');
        }

        // Build conditions for filtering
        const conditions: string[] = ['indexdef LIKE \'%vector_%ops%\''];

        if (schema) {
            const escapedSchema = schema.replace(/'/g, "''");
            conditions.push(`schemaname = '${escapedSchema}'`);
        }

        if (table) {
            const escapedTable = table.replace(/'/g, "''");
            conditions.push(`tablename = '${escapedTable}'`);
        }

        if (index_type === 'ivfflat') {
            conditions.push(`indexdef LIKE '%USING ivfflat%'`);
        } else if (index_type === 'hnsw') {
            conditions.push(`indexdef LIKE '%USING hnsw%'`);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // Query vector indexes with parsed parameters
        const listIndexesSql = `
            SELECT
                schemaname,
                tablename,
                indexname,
                CASE
                    WHEN indexdef LIKE '%USING ivfflat%' THEN 'IVFFlat'
                    WHEN indexdef LIKE '%USING hnsw%' THEN 'HNSW'
                    ELSE 'Unknown'
                END AS index_type,
                CASE
                    WHEN indexdef ~ 'lists\\s*=\\s*(\\d+)' THEN
                        (regexp_match(indexdef, 'lists\\s*=\\s*(\\d+)'))[1]::int
                    ELSE NULL
                END AS lists_param,
                CASE
                    WHEN indexdef ~ 'm\\s*=\\s*(\\d+)' THEN
                        (regexp_match(indexdef, 'm\\s*=\\s*(\\d+)'))[1]::int
                    ELSE NULL
                END AS m_param,
                CASE
                    WHEN indexdef ~ 'ef_construction\\s*=\\s*(\\d+)' THEN
                        (regexp_match(indexdef, 'ef_construction\\s*=\\s*(\\d+)'))[1]::int
                    ELSE NULL
                END AS ef_construction_param,
                CASE
                    WHEN indexdef LIKE '%vector_l2_ops%' THEN 'L2 (Euclidean)'
                    WHEN indexdef LIKE '%vector_cosine_ops%' THEN 'Cosine'
                    WHEN indexdef LIKE '%vector_ip_ops%' THEN 'Inner Product'
                    ELSE NULL
                END AS distance_operator,
                indexdef
            FROM pg_indexes
            ${whereClause}
            ORDER BY schemaname, tablename, indexname
        `;

        const result = await executeSqlWithFallback(client, listIndexesSql, true);
        return handleSqlResponse(result, ListVectorIndexesOutputSchema);
    },
};
