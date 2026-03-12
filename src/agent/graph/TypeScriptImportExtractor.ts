/**
 * TypeScript Import Extractor - Extracts import relationships using TypeScript Compiler API
 */

import * as ts from 'typescript';
import { ImportRelationship, FilePath, SymbolName } from './types';

export class TypeScriptImportExtractor {
  /**
   * Extract import relationships from a TypeScript file
   */
  extract(filePath: FilePath, content: string): ImportRelationship[] {
    const imports: ImportRelationship[] = [];

    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true
    );

    const visit = (node: ts.Node) => {
      // 1. Static imports: import { sym } from 'path'
      if (ts.isImportDeclaration(node)) {
        const moduleSpecifier = node.moduleSpecifier;
        if (!ts.isStringLiteral(moduleSpecifier)) return;

        const source = moduleSpecifier.text;
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;

        if (node.importClause) {
          // Named imports: { sym1, sym2 }
          if (node.importClause.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
            for (const element of node.importClause.namedBindings.elements) {
              const symbolName = element.name.getText(sourceFile) as SymbolName;
              imports.push({
                importer: filePath,
                source,
                symbol: symbolName,
                line,
                type: 'named'
              });
            }
          }

          // Default import: import sym from 'path'
          if (node.importClause.name) {
            const symbolName = node.importClause.name.getText(sourceFile) as SymbolName;
            imports.push({
              importer: filePath,
              source,
              symbol: symbolName,
              line,
              type: 'default'
            });
          }

          // Namespace import: import * as sym from 'path'
          if (node.importClause.namedBindings && ts.isNamespaceImport(node.importClause.namedBindings)) {
            const symbolName = node.importClause.namedBindings.name.getText(sourceFile) as SymbolName;
            imports.push({
              importer: filePath,
              source,
              symbol: symbolName,
              line,
              type: 'namespace'
            });
          }
        } else {
          // Side-effect import: import 'path'
          imports.push({
            importer: filePath,
            source,
            symbol: '*' as SymbolName,
            line,
            type: 'side-effect'
          });
        }
      }

      // 2. Dynamic imports: import('path')
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) {
          imports.push({
            importer: filePath,
            source: arg.text,
            symbol: '*' as SymbolName,
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            type: 'dynamic'
          });
        }
      }

      // 3. CommonJS require: const x = require('path')
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) {
          imports.push({
            importer: filePath,
            source: arg.text,
            symbol: '*' as SymbolName,
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            type: 'require'
          });
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return imports;
  }
}
