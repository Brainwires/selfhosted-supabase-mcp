/**
 * Security Configuration - Tool filtering based on security profiles.
 * Extracted from index.ts for modularity.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getProfileTools, isValidProfile, type SecurityProfile } from '../security-profiles.js';
import type { AppTool } from '../tools/registry.js';

export interface SecurityConfig {
    profile: string;
    enabledToolNames: Set<string>;
}

/**
 * Loads and validates security configuration.
 * Returns the set of enabled tool names based on profile or config file.
 */
export function loadSecurityConfig(
    securityProfile: string,
    toolsConfigPath: string | undefined,
    availableToolNames: string[]
): SecurityConfig {
    // Validate security profile
    if (!isValidProfile(securityProfile)) {
        throw new Error(`Invalid security profile '${securityProfile}'. Valid options: readonly, standard, admin, custom`);
    }

    let enabledToolNames: Set<string>;

    if (securityProfile === 'custom') {
        enabledToolNames = loadCustomToolConfig(toolsConfigPath, availableToolNames);
    } else {
        const profileTools = getProfileTools(securityProfile as SecurityProfile);
        enabledToolNames = profileTools ? new Set(profileTools) : new Set(availableToolNames);
    }

    return {
        profile: securityProfile,
        enabledToolNames,
    };
}

/**
 * Loads custom tool configuration from a JSON file.
 */
function loadCustomToolConfig(
    toolsConfigPath: string | undefined,
    availableToolNames: string[]
): Set<string> {
    if (!toolsConfigPath) {
        throw new Error('--tools-config is required when using --security-profile custom');
    }

    const resolvedPath = path.resolve(toolsConfigPath);
    console.error(`Loading custom tool configuration from: ${resolvedPath}`);

    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Tool configuration file not found at ${resolvedPath}`);
    }

    const configFileContent = fs.readFileSync(resolvedPath, 'utf-8');
    const configJson = JSON.parse(configFileContent);

    if (!configJson || typeof configJson !== 'object' || !Array.isArray(configJson.enabledTools)) {
        throw new Error('Invalid config file format. Expected { "enabledTools": ["tool1", ...] }.');
    }

    const toolNames = configJson.enabledTools as unknown[];
    if (!toolNames.every((name): name is string => typeof name === 'string')) {
        throw new Error('Invalid config file content. "enabledTools" must be an array of strings.');
    }

    const enabledNames = new Set(
        toolNames.map(name => name.trim()).filter(name => name.length > 0)
    );

    // Warn about unknown tools
    for (const requestedName of enabledNames) {
        if (!availableToolNames.includes(requestedName)) {
            console.warn(`Warning: Tool "${requestedName}" specified but not found in available tools.`);
        }
    }

    return enabledNames;
}

/**
 * Filters tools based on security configuration.
 * Returns only the tools that are enabled.
 */
export function filterTools(
    allTools: Record<string, AppTool>,
    securityConfig: SecurityConfig
): Record<string, AppTool> {
    const filteredTools: Record<string, AppTool> = {};

    for (const [toolName, tool] of Object.entries(allTools)) {
        if (securityConfig.enabledToolNames.has(toolName)) {
            filteredTools[toolName] = tool;
        } else {
            console.error(`Tool ${toolName} disabled by security profile.`);
        }
    }

    console.error(`Enabled tools (${Object.keys(filteredTools).length}): ${Object.keys(filteredTools).join(', ')}`);

    return filteredTools;
}
