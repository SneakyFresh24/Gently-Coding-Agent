import * as vscode from 'vscode';
import { ToolRegistry } from './ToolRegistry';
import { LogService } from '../../services/LogService';

const log = new LogService('QuestionTools');

interface QuestionOption {
  label: string;
  description?: string;
  mode?: string;
}

interface QuestionParams {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiple?: boolean;
}

interface QuestionPick extends vscode.QuickPickItem {
  mode?: string;
}

export class QuestionTools {
  registerTools(registry: ToolRegistry): void {
    registry.register('ask_question', this.askQuestion.bind(this));
  }

  private async askQuestion(params: QuestionParams): Promise<any> {
    const question = String(params?.question || '').trim();
    const options = Array.isArray(params?.options)
      ? params.options.filter((opt) => opt && typeof opt.label === 'string' && opt.label.trim() !== '')
      : [];

    if (!question || options.length === 0) {
      return {
        success: false,
        message: 'Invalid ask_question input. Expected non-empty question and at least one option.'
      };
    }

    log.info(`Asking question: ${question}`);

    const picks: QuestionPick[] = options.map((opt) => ({
      label: opt.label,
      description: opt.description,
      detail: opt.mode ? `Switch mode: ${opt.mode}` : undefined,
      mode: opt.mode
    }));

    const selected = await vscode.window.showQuickPick<QuestionPick>(picks, {
      title: params.header ? String(params.header).slice(0, 30) : undefined,
      placeHolder: question,
      canPickMany: Boolean(params.multiple),
      ignoreFocusOut: true
    });

    if (!selected) {
      return { success: false, message: 'User dismissed the question' };
    }

    const selections: QuestionPick[] = Array.isArray(selected) ? selected : [selected];
    const selectedLabels = selections.map((s) => s.label);
    const modeToSwitch = selections[0]?.mode ? String(selections[0].mode) : null;

    return {
      success: true,
      answer: selectedLabels,
      message: `User selected: ${selectedLabels.join(', ')}`,
      requestedMode: modeToSwitch,
      continuationPrompt: modeToSwitch
        ? `User selected "${selectedLabels[0]}". Continue in ${modeToSwitch} mode.`
        : `User selected: ${selectedLabels.join(', ')}. Continue accordingly.`
    };
  }
}
