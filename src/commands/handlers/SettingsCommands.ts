// =====================================================
// Settings Commands
// =====================================================

import * as vscode from 'vscode';
import { CommandHandler, CommandContext, SettingsMenuOption } from '../types/CommandTypes';

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

  static openSettingsMenu(context: CommandContext): CommandHandler {
    return {
      command: 'gently.openSettingsMenu',
      handler: async () => {
        const options: SettingsMenuOption[] = [
          { label: '$(key) Change API Key', value: 'apikey' },
          { label: '$(gear) VS Code Settings', value: 'settings' },
          { label: '$(question) OpenRouter Docs', value: 'docs' },
          { label: '$(github) GitHub Repository', value: 'github' },
        ];

        const selected = await vscode.window.showQuickPick(options, {
          placeHolder: 'Gently Menu',
        });

        if (!selected) return;

        switch (selected.value) {
          case 'apikey':
            await vscode.commands.executeCommand('gently.configureApiKey');
            break;
          case 'settings':
            vscode.commands.executeCommand('workbench.action.openSettings', 'gently');
            break;
          case 'docs':
            vscode.env.openExternal(vscode.Uri.parse('https://openrouter.ai/docs'));
            break;
          case 'github':
            vscode.env.openExternal(vscode.Uri.parse('https://github.com/gently-ai/gently-vscode-extension'));
            break;
        }
      },
    };
  }

  static getAllCommands(context: CommandContext): CommandHandler[] {
    return [
      SettingsCommands.configureApiKey(context),
      SettingsCommands.openSettingsMenu(context),
    ];
  }
}