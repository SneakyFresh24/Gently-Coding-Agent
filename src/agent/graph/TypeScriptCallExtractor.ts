/**
 * TypeScript Call Extractor - Extracts call relationships using TypeScript Compiler API
 */

import * as ts from 'typescript';
import {
  CallRelationship,
  SymbolDefinition,
  CallType,
  FilePath,
  SymbolName,
  FullSymbolIdentifier
} from './types';

export class TypeScriptCallExtractor {
  /**
   * Extract call relationships and symbol definitions from a TypeScript file
   */
  extract(filePath: FilePath, content: string): {
    calls: CallRelationship[];
    symbols: SymbolDefinition[];
  } {
    const calls: CallRelationship[] = [];
    const symbols: SymbolDefinition[] = [];

    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true
    );

    const visit = (node: ts.Node) => {
      // 1. Track symbol definitions (Function, Class, Method)
      if (ts.isFunctionDeclaration(node) && node.name) {
        symbols.push(this.createSymbol(node.name.getText(sourceFile) as SymbolName, filePath, node, sourceFile, 'function'));
      } else if (ts.isClassDeclaration(node) && node.name) {
        symbols.push(this.createSymbol(node.name.getText(sourceFile) as SymbolName, filePath, node, sourceFile, 'class'));
      } else if (ts.isMethodDeclaration(node) && node.name) {
        const className = this.findEnclosingClassName(node, sourceFile);
        const nameText = node.name.getText(sourceFile);
        const fullName = (className ? `${className}.${nameText}` : nameText) as SymbolName;
        symbols.push(this.createSymbol(fullName, filePath, node, sourceFile, 'method'));
      } else if (ts.isVariableDeclaration(node) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
        symbols.push(this.createSymbol(node.name.getText(sourceFile) as SymbolName, filePath, node, sourceFile, 'function'));
      }

      // 2. Track call expressions
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const callee = ts.isCallExpression(node)
          ? this.extractCalleeName(node, sourceFile)
          : node.expression.getText(sourceFile);

        const caller = this.findEnclosingFunctionName(node, sourceFile);

        if (callee && caller) {
          const position = sourceFile.getLineAndCharacterOfPosition(node.getStart());
          calls.push({
            caller: `${filePath}:${caller}` as FullSymbolIdentifier, // Cast at the boundary to Branded Type
            callee: callee as SymbolName,
            line: position.line + 1,
            column: position.character + 1,
            type: ts.isNewExpression(node) ? 'constructor' : this.getCallType(node as ts.CallExpression),
            context: node.expression.getText(sourceFile)
          });
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return { calls, symbols };
  }

  private createSymbol(name: SymbolName, file: FilePath, node: ts.Node, sourceFile: ts.SourceFile, kind: SymbolDefinition['kind']): SymbolDefinition {
    return {
      name,
      file,
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      kind,
      exported: this.isExported(node),
      signature: node.getText(sourceFile).split('\n')[0]
    };
  }

  private findEnclosingFunctionName(node: ts.Node, sourceFile: ts.SourceFile): string | null {
    let parent = node.parent;
    while (parent) {
      if (ts.isFunctionDeclaration(parent) && parent.name) return parent.name.getText(sourceFile);
      if (ts.isMethodDeclaration(parent) && parent.name) {
        const className = this.findEnclosingClassName(parent, sourceFile);
        const nameText = parent.name.getText(sourceFile);
        return className ? `${className}.${nameText}` : nameText;
      }
      if (ts.isVariableDeclaration(parent) && parent.name && parent.initializer && (ts.isArrowFunction(parent.initializer) || ts.isFunctionExpression(parent.initializer))) {
        return parent.name.getText(sourceFile);
      }
      parent = parent.parent;
    }
    return null;
  }

  private extractCalleeName(node: ts.CallExpression, sourceFile: ts.SourceFile): string | null {
    const expr = node.expression;
    if (ts.isIdentifier(expr)) return expr.getText(sourceFile);
    if (ts.isPropertyAccessExpression(expr)) return expr.name.getText(sourceFile);
    if (ts.isElementAccessExpression(expr)) {
      const arg = expr.argumentExpression;
      if (ts.isStringLiteral(arg)) return arg.text;
    }
    return null;
  }

  private getCallType(node: ts.CallExpression): CallType {
    const expr = node.expression;
    if (ts.isPropertyAccessExpression(expr)) return 'method';
    if (ts.isElementAccessExpression(expr)) return 'property';
    return 'direct';
  }

  private isExported(node: ts.Node): boolean {
    if (ts.canHaveModifiers(node)) {
      const modifiers = ts.getModifiers(node);
      if (modifiers) {
        return modifiers.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword);
      }
    }
    return false;
  }

  private findEnclosingClassName(node: ts.Node, sourceFile: ts.SourceFile): string | null {
    let parent = node.parent;
    while (parent) {
      if (ts.isClassDeclaration(parent) && parent.name) {
        return parent.name.getText(sourceFile);
      }
      parent = parent.parent;
    }
    return null;
  }
}
