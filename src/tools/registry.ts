/**
 * Tool Registry - Centralizes all tool imports and registration.
 * Extracted from index.ts to keep the main file manageable.
 */

import { z } from 'zod';
import type { ToolContext } from './types.js';

// Schema tools
import { listTablesTool } from './list_tables.js';
import { listExtensionsTool } from './list_extensions.js';
import { listMigrationsTool } from './list_migrations.js';
import { applyMigrationTool } from './apply_migration.js';

// SQL execution
import { executeSqlTool } from './execute_sql.js';

// Database stats
import { getDatabaseConnectionsTool } from './get_database_connections.js';
import { getDatabaseStatsTool } from './get_database_stats.js';

// Project config
import { getProjectUrlTool } from './get_project_url.js';
import { getAnonKeyTool } from './get_anon_key.js';
import { getServiceKeyTool } from './get_service_key.js';
import { generateTypesTool } from './generate_typescript_types.js';
import { rebuildHooksTool } from './rebuild_hooks.js';
import { verifyJwtSecretTool } from './verify_jwt_secret.js';

// RLS tools
import { listRlsPoliciesTool } from './list_rls_policies.js';
import { getRlsStatusTool } from './get_rls_status.js';
import { enableRlsOnTableTool } from './enable_rls_on_table.js';
import { createRlsPolicyTool } from './create_rls_policy.js';
import { dropRlsPolicyTool } from './drop_rls_policy.js';

// Functions & Triggers
import { listDatabaseFunctionsTool } from './list_database_functions.js';
import { getFunctionDefinitionTool } from './get_function_definition.js';
import { listTriggersTool } from './list_triggers.js';
import { getTriggerDefinitionTool } from './get_trigger_definition.js';

// Indexes
import { listIndexesTool } from './list_indexes.js';
import { getIndexStatsTool } from './get_index_stats.js';
import { createIndexTool } from './create_index.js';
import { dropIndexTool } from './drop_index.js';

// Query Analysis
import { explainQueryTool } from './explain_query.js';

// Column & Constraint Metadata
import { listTableColumnsTool } from './list_table_columns.js';
import { listForeignKeysTool } from './list_foreign_keys.js';
import { listConstraintsTool } from './list_constraints.js';

// Auth Users (consolidated admin tool)
import { userAdminTool } from './user_admin.js';

// Auth Sessions (RLS enforced in HTTP mode)
import { listAuthSessionsTool } from './list_auth_sessions.js';
import { revokeSessionTool } from './revoke_session.js';

// Auth Flow (client authentication tools)
import { signinWithPasswordTool } from './signin_with_password.js';
import { signupUserTool } from './signup_user.js';
import { signoutUserTool } from './signout_user.js';
import { generateUserTokenTool } from './generate_user_token.js';

// Storage
import listStorageBucketsTool from './list_storage_buckets.js';
import listStorageObjectsTool from './list_storage_objects.js';
import { createStorageBucketTool } from './create_storage_bucket.js';
import { deleteStorageBucketTool } from './delete_storage_bucket.js';
import { deleteStorageObjectTool } from './delete_storage_object.js';

// Realtime
import listRealtimePublicationsTool from './list_realtime_publications.js';

// Extensions
import { listAvailableExtensionsTool } from './list_available_extensions.js';
import { enableExtensionTool } from './enable_extension.js';
import { disableExtensionTool } from './disable_extension.js';

/**
 * Structure for tool definitions used by MCP.
 */
export interface McpToolSchema {
    name: string;
    description?: string;
    inputSchema: object;
}

/**
 * Internal tool structure with execution logic.
 */
export interface AppTool {
    name: string;
    description: string;
    inputSchema: z.ZodTypeAny;
    mcpInputSchema: object;
    outputSchema?: z.ZodTypeAny;
    execute: (input: unknown, context: ToolContext) => Promise<unknown>;
}

/**
 * All available tools, keyed by name.
 * Auth tools use service key for privileged operations.
 * Session tools have RLS enforcement in HTTP mode (users see/manage only their own).
 */
export const availableTools: Record<string, AppTool> = {
    // Schema & Migrations
    [listTablesTool.name]: listTablesTool as AppTool,
    [listExtensionsTool.name]: listExtensionsTool as AppTool,
    [listMigrationsTool.name]: listMigrationsTool as AppTool,
    [applyMigrationTool.name]: applyMigrationTool as AppTool,

    // SQL Execution
    [executeSqlTool.name]: executeSqlTool as AppTool,

    // Database Stats
    [getDatabaseConnectionsTool.name]: getDatabaseConnectionsTool as AppTool,
    [getDatabaseStatsTool.name]: getDatabaseStatsTool as AppTool,

    // Project Config
    [getProjectUrlTool.name]: getProjectUrlTool as AppTool,
    [getAnonKeyTool.name]: getAnonKeyTool as AppTool,
    [getServiceKeyTool.name]: getServiceKeyTool as AppTool,
    [generateTypesTool.name]: generateTypesTool as AppTool,
    [rebuildHooksTool.name]: rebuildHooksTool as AppTool,
    [verifyJwtSecretTool.name]: verifyJwtSecretTool as AppTool,

    // RLS
    [listRlsPoliciesTool.name]: listRlsPoliciesTool as AppTool,
    [getRlsStatusTool.name]: getRlsStatusTool as AppTool,
    [enableRlsOnTableTool.name]: enableRlsOnTableTool as AppTool,
    [createRlsPolicyTool.name]: createRlsPolicyTool as AppTool,
    [dropRlsPolicyTool.name]: dropRlsPolicyTool as AppTool,

    // Functions & Triggers
    [listDatabaseFunctionsTool.name]: listDatabaseFunctionsTool as AppTool,
    [getFunctionDefinitionTool.name]: getFunctionDefinitionTool as AppTool,
    [listTriggersTool.name]: listTriggersTool as AppTool,
    [getTriggerDefinitionTool.name]: getTriggerDefinitionTool as AppTool,

    // Indexes
    [listIndexesTool.name]: listIndexesTool as AppTool,
    [getIndexStatsTool.name]: getIndexStatsTool as AppTool,
    [createIndexTool.name]: createIndexTool as AppTool,
    [dropIndexTool.name]: dropIndexTool as AppTool,

    // Query Analysis
    [explainQueryTool.name]: explainQueryTool as AppTool,

    // Column & Constraint Metadata
    [listTableColumnsTool.name]: listTableColumnsTool as AppTool,
    [listForeignKeysTool.name]: listForeignKeysTool as AppTool,
    [listConstraintsTool.name]: listConstraintsTool as AppTool,

    // Auth Users (consolidated admin tool)
    [userAdminTool.name]: userAdminTool as AppTool,

    // Auth Sessions (RLS enforced in HTTP mode)
    [listAuthSessionsTool.name]: listAuthSessionsTool as AppTool,
    [revokeSessionTool.name]: revokeSessionTool as AppTool,

    // Auth Flow (client authentication tools)
    [signinWithPasswordTool.name]: signinWithPasswordTool as AppTool,
    [signupUserTool.name]: signupUserTool as AppTool,
    [signoutUserTool.name]: signoutUserTool as AppTool,
    [generateUserTokenTool.name]: generateUserTokenTool as AppTool,

    // Storage
    [listStorageBucketsTool.name]: listStorageBucketsTool as AppTool,
    [listStorageObjectsTool.name]: listStorageObjectsTool as AppTool,
    [createStorageBucketTool.name]: createStorageBucketTool as AppTool,
    [deleteStorageBucketTool.name]: deleteStorageBucketTool as AppTool,
    [deleteStorageObjectTool.name]: deleteStorageObjectTool as AppTool,

    // Realtime
    [listRealtimePublicationsTool.name]: listRealtimePublicationsTool as AppTool,

    // Extensions
    [listAvailableExtensionsTool.name]: listAvailableExtensionsTool as AppTool,
    [enableExtensionTool.name]: enableExtensionTool as AppTool,
    [disableExtensionTool.name]: disableExtensionTool as AppTool,
};

/**
 * Builds MCP capabilities from a filtered set of tools.
 */
export function buildCapabilities(tools: Record<string, AppTool>): {
    tools: Record<string, McpToolSchema>;
} {
    const capabilitiesTools: Record<string, McpToolSchema> = {};

    for (const tool of Object.values(tools)) {
        const staticInputSchema = tool.mcpInputSchema || { type: 'object', properties: {} };

        if (!tool.mcpInputSchema) {
            console.error(`Tool ${tool.name} is missing mcpInputSchema. Using default empty schema.`);
        }

        capabilitiesTools[tool.name] = {
            name: tool.name,
            description: tool.description || 'Tool description missing',
            inputSchema: staticInputSchema,
        };
    }

    return { tools: capabilitiesTools };
}

/**
 * Gets the list of all available tool names.
 */
export function getAvailableToolNames(): string[] {
    return Object.keys(availableTools);
}
