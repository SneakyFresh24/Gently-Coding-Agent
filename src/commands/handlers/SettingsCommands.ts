// =====================================================
// Settings Commands
// =====================================================

import * as vscode from 'vscode';
import { CommandHandler, CommandContext } from '../types/CommandTypes';

export class SettingsCommands {
  static configureApiKey(context: CommandContext): CommandHandler {
    return {
      command: 'gently.configureApiKey',
      handler: async () => {
        const current = await context.apiKeyManager.getKey();
        const key = await vscode.window.showInputBox({
          prompt: 'Enter your OpenRouter API Key',
          placeHolder: 'sk-or-...',
          value: current ? '••••••••' : '',
          password: true,
          validateInput: (v) => (!v || v === '••••••••') ? 'Please enter a valid API key' : null,
        });

        if (!key || key === '••••••••') return;

        await context.apiKeyManager.setKey(key);
        vscode.window.showInformationMessage('✅ OpenRouter API key saved! You can now start chatting.');
        context.chatViewProvider.refresh();
      },
    };
  }

  static getAllCommands(context: CommandContext): CommandHandler[] {
    return [
      SettingsCommands.configureApiKey(context)
    ];
  }
}
