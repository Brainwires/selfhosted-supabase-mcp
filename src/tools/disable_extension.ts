import { z } from 'zod';
import type { ToolContext } from './types.js';
import { executeSqlWithFallback } from './utils.js';

// Input schema
const DisableExtensionInputSchema = z.object({
    extension_name: z.string().describe('Name of the extension to disable.'),
    cascade: z.boolean().optional().default(false).describe('Also drop objects that depend on this extension.'),
    confirm: z.boolean().optional().default(false).describe('Must be true to execute. Without this, returns a preview.'),
});
type DisableExtensionInput = z.infer<typeof DisableExtensionInputSchema>;

// Output schema
const DisableExtensionOutputSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    action: z.enum(['preview', 'disabled', 'not_installed']),
    extension: z.object({
        name: z.string(),
        version: z.string(),
        schema: z.string(),
    }).optional(),
    sql: z.string().optional(),
});

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        extension_name: {
            type: 'string',
            description: 'Name of the extension to disable.',
        },
        cascade: {
            type: 'boolean',
            default: false,
            description: 'Also drop objects that depend on this extension.',
        },
        confirm: {
            type: 'boolean',
            default: false,
            description: 'Must be true to execute. Without this, returns a preview.',
        },
    },
    required: ['extension_name'],
};

export const disableExtensionTool = {
    name: 'disable_extension',
    description: 'Disables (uninstalls) a PostgreSQL extension. Requires confirm=true to execute. Use cascade=true to drop dependent objects.',
    inputSchema: DisableExtensionInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: DisableExtensionOutputSchema,

    execute: async (input: DisableExtensionInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { extension_name, cascade, confirm } = input;

        if (!client.isPgAvailable()) {
            throw new Error('Direct database connection (DATABASE_URL) is required for disabling extensions but is not configured or available.');
        }

        try {
            // Check if extension is installed
            const extensionInfo = await executeSqlWithFallback(client, `
                SELECT
                    e.extname AS name,
                    e.extversion AS version,
                    n.nspname AS schema
                FROM pg_extension e
                JOIN pg_namespace n ON n.oid = e.extnamespace
                WHERE e.extname = '${extension_name.replace(/'/g, "''")}'
            `, true);

            if (!extensionInfo.success || (extensionInfo.data as unknown[]).length === 0) {
                return {
                    success: true,
                    message: `Extension "${extension_name}" is not installed.`,
                    action: 'not_installed' as const,
                };
            }

            const extData = (extensionInfo.data as unknown[])[0] as {
                name: string;
                version: string;
                schema: string;
            };

            // Check for dependent objects if not using cascade
            if (!cascade) {
                const dependentsCheck = await executeSqlWithFallback(client, `
                    SELECT COUNT(*) AS dep_count
                    FROM pg_depend d
                    JOIN pg_extension e ON e.oid = d.refobjid
                    WHERE e.extname = '${extension_name.replace(/'/g, "''")}'
                      AND d.deptype = 'e'
                `, true);

                if (dependentsCheck.success) {
                    const depCount = ((dependentsCheck.data as unknown[])[0] as { dep_count: number })?.dep_count || 0;
                    if (depCount > 0) {
                        return {
                            success: false,
                            message: `Extension "${extension_name}" has ${depCount} dependent object(s). Use cascade=true to drop them.`,
                            action: 'preview' as const,
                            extension: extData,
                        };
                    }
                }
            }

            // Build the DROP EXTENSION statement
            let dropSql = `DROP EXTENSION IF EXISTS "${extension_name}"`;
            if (cascade) {
                dropSql += ' CASCADE';
            }

            // If not confirmed, return preview
            if (!confirm) {
                return {
                    success: true,
                    message: `Preview: Will disable extension "${extension_name}" (version ${extData.version} in schema "${extData.schema}")${cascade ? ' with CASCADE' : ''}. Set confirm=true to execute.`,
                    action: 'preview' as const,
                    extension: extData,
                    sql: dropSql,
                };
            }

            // Execute the extension removal
            await client.executeTransactionWithPg(async (pgClient) => {
                await pgClient.query(dropSql);
            });

            context.log?.(`Disabled extension "${extension_name}"${cascade ? ' with CASCADE' : ''}`, 'warn');

            return {
                success: true,
                message: `Successfully disabled extension "${extension_name}"${cascade ? ' (cascade)' : ''}.`,
                action: 'disabled' as const,
                extension: extData,
                sql: dropSql,
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to disable extension "${extension_name}": ${errorMessage}`);
        }
    },
};
