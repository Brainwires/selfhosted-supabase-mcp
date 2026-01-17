import { z } from 'zod';
import type { ToolContext } from './types.js';
import { handleSqlResponse, executeSqlWithFallback } from './utils.js';

// Output schema for available extensions
const ListAvailableExtensionsOutputSchema = z.array(z.object({
    name: z.string(),
    default_version: z.string(),
    installed_version: z.string().nullable(),
    is_installed: z.boolean(),
    comment: z.string().nullable(),
}));

// Input schema
const ListAvailableExtensionsInputSchema = z.object({
    show_installed: z.boolean().optional().default(true).describe('Include already installed extensions.'),
    name_pattern: z.string().optional().describe('Filter by extension name pattern (SQL LIKE).'),
});
type ListAvailableExtensionsInput = z.infer<typeof ListAvailableExtensionsInputSchema>;

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        show_installed: {
            type: 'boolean',
            default: true,
            description: 'Include already installed extensions.',
        },
        name_pattern: {
            type: 'string',
            description: 'Filter by extension name pattern (SQL LIKE).',
        },
    },
    required: [],
};

export const listAvailableExtensionsTool = {
    name: 'list_available_extensions',
    description: 'Lists all PostgreSQL extensions available for installation, including those already installed.',
    inputSchema: ListAvailableExtensionsInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: ListAvailableExtensionsOutputSchema,

    execute: async (input: ListAvailableExtensionsInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { show_installed, name_pattern } = input;

        // Build WHERE conditions
        const conditions: string[] = [];

        if (!show_installed) {
            conditions.push('installed_version IS NULL');
        }
        if (name_pattern) {
            conditions.push(`name LIKE '${name_pattern.replace(/'/g, "''")}'`);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const sql = `
            SELECT
                name,
                default_version,
                installed_version,
                installed_version IS NOT NULL AS is_installed,
                comment
            FROM pg_available_extensions
            ${whereClause}
            ORDER BY name
        `;

        const result = await executeSqlWithFallback(client, sql, true);
        return handleSqlResponse(result, ListAvailableExtensionsOutputSchema);
    },
};
