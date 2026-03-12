// =====================================================
// API Key Manager – Secure storage via VS Code SecretStorage
// =====================================================

import * as vscode from 'vscode';

const SECRET_KEY = 'gently.openrouter.apiKey';

export class ApiKeyManager {
    constructor(private readonly secrets: vscode.SecretStorage) { }

    async setKey(key: string): Promise<void> {
        await this.secrets.store(SECRET_KEY, key.trim());
        console.log('[ApiKeyManager] API key stored');
    }

    async getKey(): Promise<string | undefined> {
        return await this.secrets.get(SECRET_KEY);
    }

    async deleteKey(): Promise<void> {
        await this.secrets.delete(SECRET_KEY);
        console.log('[ApiKeyManager] API key deleted');
    }

    async hasKey(): Promise<boolean> {
        const key = await this.getKey();
        return !!(key && key.length > 0);
    }
}
