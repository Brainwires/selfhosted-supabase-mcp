/**
 * Credential Manager - Handles persistence and loading of MCP server user credentials.
 * Stores credentials in a local config file for automatic login on startup.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface StoredCredentials {
    email: string;
    password: string;
    userId?: string;
    createdAt: string;
}

export interface SessionTokens {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    userId: string;
    email: string;
}

/**
 * Manages persistent storage of MCP server user credentials.
 * Default location: ~/.config/supabase-mcp/credentials.json
 */
export class CredentialManager {
    private readonly configDir: string;
    private readonly credentialsFile: string;

    constructor(configDir?: string) {
        this.configDir = configDir ?? join(homedir(), '.config', 'supabase-mcp');
        this.credentialsFile = join(this.configDir, 'credentials.json');
    }

    /**
     * Checks if stored credentials exist.
     */
    hasStoredCredentials(): boolean {
        return existsSync(this.credentialsFile);
    }

    /**
     * Loads stored credentials from disk.
     * Returns null if no credentials are stored.
     */
    loadCredentials(): StoredCredentials | null {
        if (!this.hasStoredCredentials()) {
            return null;
        }

        try {
            const content = readFileSync(this.credentialsFile, 'utf-8');
            const credentials = JSON.parse(content) as StoredCredentials;

            // Validate required fields
            if (!credentials.email || !credentials.password) {
                console.error('[CredentialManager] Invalid credentials file - missing required fields');
                return null;
            }

            return credentials;
        } catch (error) {
            console.error('[CredentialManager] Failed to load credentials:', error);
            return null;
        }
    }

    /**
     * Saves credentials to disk.
     */
    saveCredentials(credentials: StoredCredentials): void {
        try {
            // Ensure config directory exists
            if (!existsSync(this.configDir)) {
                mkdirSync(this.configDir, { recursive: true, mode: 0o700 });
            }

            // Write credentials with restricted permissions
            writeFileSync(
                this.credentialsFile,
                JSON.stringify(credentials, null, 2),
                { mode: 0o600 }
            );

            console.error(`[CredentialManager] Credentials saved to ${this.credentialsFile}`);
        } catch (error) {
            console.error('[CredentialManager] Failed to save credentials:', error);
            throw new Error(`Failed to save credentials: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Deletes stored credentials.
     */
    deleteCredentials(): void {
        if (this.hasStoredCredentials()) {
            try {
                unlinkSync(this.credentialsFile);
                console.error('[CredentialManager] Credentials deleted');
            } catch (error) {
                console.error('[CredentialManager] Failed to delete credentials:', error);
            }
        }
    }

    /**
     * Generates a random email for auto-created MCP user accounts.
     * Format: mcp-server-<random>@localhost
     */
    static generateEmail(): string {
        const randomId = randomBytes(8).toString('hex');
        return `mcp-server-${randomId}@localhost`;
    }

    /**
     * Generates a secure random password.
     */
    static generatePassword(): string {
        return randomBytes(32).toString('base64');
    }

    /**
     * Gets the credentials file path (for logging/debugging).
     */
    getCredentialsPath(): string {
        return this.credentialsFile;
    }
}
