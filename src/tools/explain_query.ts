import { z } from 'zod';
import type { ToolContext } from './types.js';
import { executeSqlWithFallback, isSqlErrorResponse } from './utils.js';

// Output schema for query explanation
const ExplainQueryOutputSchema = z.object({
    query: z.string(),
    plan: z.unknown(), // JSON plan output
    format: z.string(),
    analyzed: z.boolean(),
    planning_time_ms: z.number().optional(),
    execution_time_ms: z.number().optional(),
    warnings: z.array(z.string()).optional(),
});

// Input schema
const ExplainQueryInputSchema = z.object({
    sql: z.string().describe('The SQL query to analyze.'),
    analyze: z.boolean().optional().default(false).describe('Actually execute the query to get real timing (use with caution - modifies data if write query).'),
    format: z.enum(['json', 'text', 'yaml', 'xml']).optional().default('json').describe('Output format for the plan.'),
    verbose: z.boolean().optional().default(false).describe('Include additional details in the plan.'),
    costs: z.boolean().optional().default(true).describe('Include estimated costs.'),
    buffers: z.boolean().optional().default(false).describe('Include buffer usage statistics (requires ANALYZE).'),
    timing: z.boolean().optional().default(true).describe('Include actual timing (requires ANALYZE).'),
    settings: z.boolean().optional().default(false).describe('Include non-default configuration settings.'),
});
type ExplainQueryInput = z.infer<typeof ExplainQueryInputSchema>;

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        sql: {
            type: 'string',
            description: 'The SQL query to analyze.',
        },
        analyze: {
            type: 'boolean',
            default: false,
            description: 'Actually execute the query to get real timing (use with caution - modifies data if write query).',
        },
        format: {
            type: 'string',
            enum: ['json', 'text', 'yaml', 'xml'],
            default: 'json',
            description: 'Output format for the plan.',
        },
        verbose: {
            type: 'boolean',
            default: false,
            description: 'Include additional details in the plan.',
        },
        costs: {
            type: 'boolean',
            default: true,
            description: 'Include estimated costs.',
        },
        buffers: {
            type: 'boolean',
            default: false,
            description: 'Include buffer usage statistics (requires ANALYZE).',
        },
        timing: {
            type: 'boolean',
            default: true,
            description: 'Include actual timing (requires ANALYZE).',
        },
        settings: {
            type: 'boolean',
            default: false,
            description: 'Include non-default configuration settings.',
        },
    },
    required: ['sql'],
};

// Helper to detect dangerous write patterns
function detectWriteQuery(sql: string): { isWrite: boolean; queryType: string } {
    const upperSql = sql.toUpperCase().trim();

    if (upperSql.startsWith('INSERT')) return { isWrite: true, queryType: 'INSERT' };
    if (upperSql.startsWith('UPDATE')) return { isWrite: true, queryType: 'UPDATE' };
    if (upperSql.startsWith('DELETE')) return { isWrite: true, queryType: 'DELETE' };
    if (upperSql.startsWith('TRUNCATE')) return { isWrite: true, queryType: 'TRUNCATE' };
    if (upperSql.startsWith('DROP')) return { isWrite: true, queryType: 'DROP' };
    if (upperSql.startsWith('ALTER')) return { isWrite: true, queryType: 'ALTER' };
    if (upperSql.startsWith('CREATE')) return { isWrite: true, queryType: 'CREATE' };

    return { isWrite: false, queryType: 'SELECT' };
}

export const explainQueryTool = {
    name: 'explain_query',
    description: 'Gets the execution plan for a SQL query without executing it (unless ANALYZE is enabled). Useful for query optimization.',
    inputSchema: ExplainQueryInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: ExplainQueryOutputSchema,

    execute: async (input: ExplainQueryInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { sql, analyze, format, verbose, costs, buffers, timing, settings } = input;

        const warnings: string[] = [];

        // Check for write queries when using ANALYZE
        const { isWrite, queryType } = detectWriteQuery(sql);
        if (analyze && isWrite) {
            warnings.push(`WARNING: ANALYZE will actually execute this ${queryType} query and modify data!`);
        }

        // Build the EXPLAIN options
        const options: string[] = [];
        options.push(`FORMAT ${format.toUpperCase()}`);
        if (analyze) options.push('ANALYZE true');
        if (verbose) options.push('VERBOSE true');
        options.push(`COSTS ${costs}`);
        if (analyze && buffers) options.push('BUFFERS true');
        if (analyze) options.push(`TIMING ${timing}`);
        if (settings) options.push('SETTINGS true');

        const explainSql = `EXPLAIN (${options.join(', ')}) ${sql}`;

        try {
            const result = await executeSqlWithFallback(client, explainSql, !analyze);

            if (isSqlErrorResponse(result)) {
                throw new Error(result.error.message || 'Failed to explain query');
            }

            const rows = result as unknown[];

            // Parse the result based on format
            let plan: unknown;
            let planningTime: number | undefined;
            let executionTime: number | undefined;

            if (format === 'json') {
                // JSON format returns an array with a single object containing 'QUERY PLAN'
                if (rows.length > 0) {
                    const firstRow = rows[0] as Record<string, unknown>;
                    const queryPlan = firstRow['QUERY PLAN'] || firstRow['query plan'];
                    if (Array.isArray(queryPlan)) {
                        plan = queryPlan;
                        // Extract timing from JSON plan
                        const planObj = queryPlan[0] as Record<string, unknown>;
                        if (planObj) {
                            planningTime = planObj['Planning Time'] as number | undefined;
                            executionTime = planObj['Execution Time'] as number | undefined;
                        }
                    } else {
                        plan = queryPlan;
                    }
                }
            } else {
                // Text/YAML/XML format returns multiple rows
                plan = rows.map(row => {
                    const r = row as Record<string, unknown>;
                    return r['QUERY PLAN'] || r['query plan'] || row;
                });
            }

            return {
                query: sql,
                plan,
                format,
                analyzed: analyze,
                planning_time_ms: planningTime,
                execution_time_ms: executionTime,
                warnings: warnings.length > 0 ? warnings : undefined,
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to explain query: ${errorMessage}`);
        }
    },
};
