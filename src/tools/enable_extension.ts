import { z } from 'zod';
import type { ToolContext } from './types.js';
import { executeSqlWithFallback, isSqlErrorResponse } from './utils.js';

// Input schema
const EnableExtensionInputSchema = z.object({
    extension_name: z.string().describe('Name of the extension to enable.'),
    schema: z.string().optional().default('extensions').describe('Schema to install the extension in (defaults to extensions).'),
    version: z.string().optional().describe('Specific version to install (defaults to default_version).'),
    cascade: z.boolean().optional().default(false).describe('Automatically install required dependencies.'),
    confirm: z.boolean().optional().default(false).describe('Must be true to execute. Without this, returns a preview.'),
});
type EnableExtensionInput = z.infer<typeof EnableExtensionInputSchema>;

// Output schema
const EnableExtensionOutputSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    action: z.enum(['preview', 'enabled', 'already_installed']),
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
            description: 'Name of the extension to enable.',
        },
        schema: {
            type: 'string',
            default: 'extensions',
            description: 'Schema to install the extension in (defaults to extensions).',
        },
        version: {
            type: 'string',
            description: 'Specific version to install (defaults to default_version).',
        },
        cascade: {
            type: 'boolean',
            default: false,
            description: 'Automatically install required dependencies.',
        },
        confirm: {
            type: 'boolean',
            default: false,
            description: 'Must be true to execute. Without this, returns a preview.',
        },
    },
    required: ['extension_name'],
};

export const enableExtensionTool = {
    name: 'enable_extension',
    description: 'Enables (installs) a PostgreSQL extension. Requires confirm=true to execute.',
    inputSchema: EnableExtensionInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: EnableExtensionOutputSchema,

    execute: async (input: EnableExtensionInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { extension_name, schema, version, cascade, confirm } = input;

        if (!client.isPgAvailable()) {
            throw new Error('Direct database connection (DATABASE_URL) is required for enabling extensions but is not configured or available.');
        }

        try {
            // Check if extension is available and its current state
            const extensionInfo = await executeSqlWithFallback(client, `
                SELECT
                    name,
                    default_version,
                    installed_version,
                    installed_version IS NOT NULL AS is_installed
                FROM pg_available_extensions
                WHERE name = '${extension_name.replace(/'/g, "''")}'
            `, true);

            if (isSqlErrorResponse(extensionInfo) || extensionInfo.length === 0) {
                return {
                    success: false,
                    message: `Extension "${extension_name}" is not available for installation.`,
                    action: 'preview' as const,
                };
            }

            const extData = extensionInfo[0] as {
                name: string;
                default_version: string;
                installed_version: string | null;
                is_installed: boolean;
            };

            if (extData.is_installed) {
                return {
                    success: true,
                    message: `Extension "${extension_name}" is already installed (version ${extData.installed_version}).`,
                    action: 'already_installed' as const,
                    extension: {
                        name: extData.name,
                        version: extData.installed_version || extData.default_version,
                        schema: schema,
                    },
                };
            }

            // Build the CREATE EXTENSION statement
            const targetVersion = version || extData.default_version;
            let createSql = `CREATE EXTENSION IF NOT EXISTS "${extension_name}"`;
            createSql += ` SCHEMA "${schema}"`;
            if (version) {
                createSql += ` VERSION '${version}'`;
            }
            if (cascade) {
                createSql += ' CASCADE';
            }

            // If not confirmed, return preview
            if (!confirm) {
                return {
                    success: true,
                    message: `Preview: Will install extension "${extension_name}" version ${targetVersion} in schema "${schema}". Set confirm=true to execute.`,
                    action: 'preview' as const,
                    extension: {
                        name: extension_name,
                        version: targetVersion,
                        schema: schema,
                    },
                    sql: createSql,
                };
            }

            // Execute the extension creation
            await client.executeTransactionWithPg(async (pgClient) => {
                // Ensure the schema exists
                await pgClient.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
                // Create the extension
                await pgClient.query(createSql);
            });

            context.log?.(`Enabled extension "${extension_name}" version ${targetVersion} in schema "${schema}"`, 'info');

            return {
                success: true,
                message: `Successfully enabled extension "${extension_name}" version ${targetVersion} in schema "${schema}".`,
                action: 'enabled' as const,
                extension: {
                    name: extension_name,
                    version: targetVersion,
                    schema: schema,
                },
                sql: createSql,
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to enable extension "${extension_name}": ${errorMessage}`);
        }
    },
};
