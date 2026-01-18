import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { CredentialManager } from '../../auth/credential-manager.js';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('CredentialManager', () => {
    let tempDir: string;
    let manager: CredentialManager;

    beforeEach(() => {
        // Create a temporary directory for each test
        tempDir = mkdtempSync(join(tmpdir(), 'supabase-mcp-test-'));
        manager = new CredentialManager(tempDir);
    });

    afterEach(() => {
        // Clean up temporary directory
        if (existsSync(tempDir)) {
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    describe('generateEmail', () => {
        test('generates valid email format', () => {
            const email = CredentialManager.generateEmail();
            expect(email).toMatch(/^mcp-server-[a-f0-9]{16}@localhost$/);
        });

        test('generates unique emails', () => {
            const emails = new Set<string>();
            for (let i = 0; i < 100; i++) {
                emails.add(CredentialManager.generateEmail());
            }
            expect(emails.size).toBe(100);
        });
    });

    describe('generatePassword', () => {
        test('generates secure password with sufficient length', () => {
            const password = CredentialManager.generatePassword();
            // Base64 encoded 32 bytes = ~43 characters
            expect(password.length).toBeGreaterThanOrEqual(40);
        });

        test('generates unique passwords', () => {
            const passwords = new Set<string>();
            for (let i = 0; i < 100; i++) {
                passwords.add(CredentialManager.generatePassword());
            }
            expect(passwords.size).toBe(100);
        });
    });

    describe('credential storage', () => {
        test('hasStoredCredentials returns false when no credentials exist', () => {
            expect(manager.hasStoredCredentials()).toBe(false);
        });

        test('saveCredentials and loadCredentials round-trip', () => {
            const credentials = {
                email: 'test@example.com',
                password: 'test-password',
                userId: 'user-123',
                createdAt: new Date().toISOString(),
            };

            manager.saveCredentials(credentials);
            expect(manager.hasStoredCredentials()).toBe(true);

            const loaded = manager.loadCredentials();
            expect(loaded).toEqual(credentials);
        });

        test('deleteCredentials removes stored credentials', () => {
            const credentials = {
                email: 'test@example.com',
                password: 'test-password',
                createdAt: new Date().toISOString(),
            };

            manager.saveCredentials(credentials);
            expect(manager.hasStoredCredentials()).toBe(true);

            manager.deleteCredentials();
            expect(manager.hasStoredCredentials()).toBe(false);
        });

        test('loadCredentials returns null for missing file', () => {
            const result = manager.loadCredentials();
            expect(result).toBeNull();
        });

        test('getCredentialsPath returns expected path', () => {
            const path = manager.getCredentialsPath();
            expect(path).toContain('credentials.json');
            expect(path).toStartWith(tempDir);
        });
    });
});
