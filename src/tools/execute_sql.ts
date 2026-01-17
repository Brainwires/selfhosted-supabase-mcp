import { z } from 'zod';
import type { SelfhostedSupabaseClient } from '../client/index.js';
import { handleSqlResponse, executeSqlWithFallback } from './utils.js';
import type { ToolContext } from './types.js';

/**
 * SQL query type classification
 */
type QueryType = 'read' | 'write' | 'ddl' | 'dangerous';

/**
 * Dangerous SQL patterns that could cause significant data loss or security issues
 */
const DANGEROUS_PATTERNS = [
    /\bDROP\s+(DATABASE|SCHEMA)\b/i,
    /\bTRUNCATE\b/i,
    /\bDELETE\s+FROM\s+\w+\s*(?:;|$)/i, // DELETE without WHERE
    /\bUPDATE\s+\w+\s+SET\b(?!.*\bWHERE\b)/i, // UPDATE without WHERE
    /\bDROP\s+TABLE\b.*\bCASCADE\b/i,
    /\bALTER\s+SYSTEM\b/i,
    /\bCREATE\s+EXTENSION\b/i,
    /\bDROP\s+EXTENSION\b/i,
    /\bGRANT\b.*\bTO\b/i,
    /\bREVOKE\b/i,
    /\bCREATE\s+USER\b/i,
    /\bDROP\s+USER\b/i,
    /\bALTER\s+USER\b/i,
    /\bCREATE\s+ROLE\b/i,
    /\bDROP\s+ROLE\b/i,
];

/**
 * DDL patterns (Data Definition Language)
 */
const DDL_PATTERNS = [
    /\bCREATE\s+(TABLE|INDEX|VIEW|FUNCTION|TRIGGER|SCHEMA|TYPE|SEQUENCE)\b/i,
    /\bALTER\s+(TABLE|INDEX|VIEW|FUNCTION|TRIGGER|SCHEMA|TYPE|SEQUENCE)\b/i,
    /\bDROP\s+(TABLE|INDEX|VIEW|FUNCTION|TRIGGER|TYPE|SEQUENCE)\b/i,
    /\bCOMMENT\s+ON\b/i,
];

/**
 * DML write patterns (Data Manipulation Language - writes)
 */
const WRITE_PATTERNS = [
    /\bINSERT\s+INTO\b/i,
    /\bUPDATE\s+\w+\s+SET\b/i,
    /\bDELETE\s+FROM\b/i,
    /\bMERGE\s+INTO\b/i,
    /\bUPSERT\b/i,
];

/**
 * Classifies a SQL query by its type
 */
function classifyQuery(sql: string): { type: QueryType; warnings: string[] } {
    const warnings: string[] = [];
    const normalizedSql = sql.trim();

    // Check for dangerous patterns first
    for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(normalizedSql)) {
            warnings.push(`Dangerous pattern detected: ${pattern.toString()}`);
            return { type: 'dangerous', warnings };
        }
    }

    // Check for DDL
    for (const pattern of DDL_PATTERNS) {
        if (pattern.test(normalizedSql)) {
            return { type: 'ddl', warnings };
        }
    }

    // Check for write operations
    for (const pattern of WRITE_PATTERNS) {
        if (pattern.test(normalizedSql)) {
            return { type: 'write', warnings };
        }
    }

    // Default to read
    return { type: 'read', warnings };
}

// Input schema with safety options
const ExecuteSqlInputSchema = z.object({
    sql: z.string().describe('The SQL query to execute.'),
    read_only: z.boolean().optional().default(false).describe(
        'Hint for the RPC function whether the query is read-only (best effort).'
    ),
    allow_write: z.boolean().optional().default(false).describe(
        'Must be set to true to execute INSERT, UPDATE, or DELETE statements.'
    ),
    allow_ddl: z.boolean().optional().default(false).describe(
        'Must be set to true to execute DDL statements (CREATE, ALTER, DROP tables/views/functions).'
    ),
    allow_dangerous: z.boolean().optional().default(false).describe(
        'Must be set to true to execute dangerous operations (DROP DATABASE, TRUNCATE, etc.). Use with extreme caution.'
    ),
    dry_run: z.boolean().optional().default(false).describe(
        'If true, only classify the query and return what would happen without executing.'
    ),
});
type ExecuteSqlInput = z.infer<typeof ExecuteSqlInputSchema>;

// Output schema - expects an array of results (rows) or dry run info
const ExecuteSqlOutputSchema = z.union([
    z.array(z.unknown()).describe('The array of rows returned by the SQL query.'),
    z.object({
        dry_run: z.literal(true),
        query_type: z.enum(['read', 'write', 'ddl', 'dangerous']),
        would_execute: z.boolean(),
        reason: z.string().optional(),
        warnings: z.array(z.string()),
    }),
]);

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        sql: { type: 'string', description: 'The SQL query to execute.' },
        read_only: {
            type: 'boolean',
            default: false,
            description: 'Hint for the RPC function whether the query is read-only (best effort).',
        },
        allow_write: {
            type: 'boolean',
            default: false,
            description: 'Must be set to true to execute INSERT, UPDATE, or DELETE statements.',
        },
        allow_ddl: {
            type: 'boolean',
            default: false,
            description: 'Must be set to true to execute DDL statements (CREATE, ALTER, DROP tables/views/functions).',
        },
        allow_dangerous: {
            type: 'boolean',
            default: false,
            description: 'Must be set to true to execute dangerous operations (DROP DATABASE, TRUNCATE, etc.). Use with extreme caution.',
        },
        dry_run: {
            type: 'boolean',
            default: false,
            description: 'If true, only classify the query and return what would happen without executing.',
        },
    },
    required: ['sql'],
};

// The tool definition
export const executeSqlTool = {
    name: 'execute_sql',
    description:
        'Executes a SQL query against the database. Read queries work by default. ' +
        'Write operations require allow_write=true. DDL operations require allow_ddl=true. ' +
        'Dangerous operations (TRUNCATE, DROP DATABASE, etc.) require allow_dangerous=true. ' +
        'Use dry_run=true to preview what would happen without executing.',
    inputSchema: ExecuteSqlInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: ExecuteSqlOutputSchema,
    execute: async (input: ExecuteSqlInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { type: queryType, warnings } = classifyQuery(input.sql);

        // Dry run mode - just return classification
        if (input.dry_run) {
            let wouldExecute = true;
            let reason: string | undefined;

            if (queryType === 'dangerous' && !input.allow_dangerous) {
                wouldExecute = false;
                reason = 'Dangerous operation requires allow_dangerous=true';
            } else if (queryType === 'ddl' && !input.allow_ddl) {
                wouldExecute = false;
                reason = 'DDL operation requires allow_ddl=true';
            } else if (queryType === 'write' && !input.allow_write) {
                wouldExecute = false;
                reason = 'Write operation requires allow_write=true';
            }

            return {
                dry_run: true as const,
                query_type: queryType,
                would_execute: wouldExecute,
                reason,
                warnings,
            };
        }

        // Check permissions based on query type
        if (queryType === 'dangerous') {
            if (!input.allow_dangerous) {
                throw new Error(
                    `Dangerous SQL operation detected. This query could cause significant data loss. ` +
                    `Set allow_dangerous=true to proceed. Warnings: ${warnings.join('; ')}`
                );
            }
            context.log?.(`DANGEROUS SQL operation executed: ${input.sql.substring(0, 100)}...`, 'warn');
        } else if (queryType === 'ddl') {
            if (!input.allow_ddl) {
                throw new Error(
                    `DDL operation detected (CREATE/ALTER/DROP). Set allow_ddl=true to proceed.`
                );
            }
            context.log?.(`DDL operation executed: ${input.sql.substring(0, 100)}...`, 'info');
        } else if (queryType === 'write') {
            if (!input.allow_write) {
                throw new Error(
                    `Write operation detected (INSERT/UPDATE/DELETE). Set allow_write=true to proceed.`
                );
            }
        }

        console.error(`Executing SQL [${queryType}] (readOnly: ${input.read_only}): ${input.sql.substring(0, 100)}...`);

        const result = await executeSqlWithFallback(client, input.sql, input.read_only);
        return handleSqlResponse(result, z.array(z.unknown()));
    },
}; 