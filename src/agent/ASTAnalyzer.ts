import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import Parser from 'web-tree-sitter';
import { FileOperations } from './fileOperations';
import { agentLogger } from '../utils';

export interface CodeChunk {
    id: string; // e.g. "MyClass.myMethod"
    type: 'class' | 'function' | 'interface' | 'method' | 'import' | 'export' | 'type_alias' | 'variable';
    name: string;
    content: string;
    startLine: number;
    endLine: number;
    dependencies: string[]; // names of other chunks/symbols it references
}

export class ASTAnalyzer {
    private parser: Parser | null = null;
    private languages: Map<string, Parser.Language> = new Map();
    private context: vscode.ExtensionContext;
    private fileOps: FileOperations;
    private initialized: boolean = false;

    constructor(context: vscode.ExtensionContext, fileOps: FileOperations) {
        this.context = context;
        this.fileOps = fileOps;
    }

    async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            const wasmPath = vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'tree-sitter', 'tree-sitter.wasm').fsPath;

            await Parser.init({
                locateFile: () => wasmPath
            });

            this.parser = new Parser();
            this.initialized = true;
            agentLogger.info('AST Analyzer initialized successfully with tree-sitter.');
        } catch (error) {
            agentLogger.error('Failed to initialize AST Analyzer:', error);
            throw new Error(`Failed to initialize AST Analyzer: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async getLanguage(ext: string): Promise<Parser.Language | null> {
        if (!this.initialized) await this.initialize();

        const langMap: Record<string, string> = {
            '.ts': 'tree-sitter-typescript.wasm',
            '.tsx': 'tree-sitter-tsx.wasm',
            '.js': 'tree-sitter-javascript.wasm',
            '.jsx': 'tree-sitter-javascript.wasm',
            '.py': 'tree-sitter-python.wasm',
            '.go': 'tree-sitter-go.wasm',
            '.rs': 'tree-sitter-rust.wasm',
            '.php': 'tree-sitter-php.wasm',
            '.html': 'tree-sitter-html.wasm',
        };

        const wasmFile = langMap[ext];
        if (!wasmFile) {
            return null;
        }

        if (this.languages.has(ext)) {
            return this.languages.get(ext)!;
        }

        try {
            const wasmPath = vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'tree-sitter', wasmFile).fsPath;
            const lang = await Parser.Language.load(wasmPath);
            this.languages.set(ext, lang);
            return lang;
        } catch (error) {
            agentLogger.error(`Failed to load tree-sitter language for ${ext}:`, error);
            return null;
        }
    }

    async analyzeFile(filePath: string, content?: string): Promise<CodeChunk[]> {
        try {
            if (!this.initialized) await this.initialize();

            const ext = path.extname(filePath).toLowerCase();
            const lang = await this.getLanguage(ext);

            if (!lang || !this.parser) {
                agentLogger.warn(`No language support found for extension ${ext} in ASTAnalyzer.`);
                return [];
            }

            this.parser.setLanguage(lang);

            const fileContent = content !== undefined ? content : await this.fileOps.getFileContent(filePath);
            const tree = this.parser.parse(fileContent);

            const chunks: CodeChunk[] = [];

            // Basic extraction for JS/TS
            if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
                this.extractTSChunks(tree.rootNode, chunks, '', fileContent);
            }

            return chunks;
        } catch (error) {
            agentLogger.error(`Error analyzing file ${filePath} with AST:`, error);
            return [];
        }
    }

    /**
     * Extract semantic tokens (identifiers, names, keywords) for indexing
     */
    async getSemanticTokens(content: string, language: string): Promise<string[]> {
        try {
            if (!this.initialized) await this.initialize();

            // Map language to extension for getLanguage
            const extMap: Record<string, string> = {
                'typescript': '.ts',
                'javascript': '.js',
                'python': '.py',
                'go': '.go',
                'rust': '.rs',
                'php': '.php',
                'html': '.html'
            };
            const ext = extMap[language] || '.ts';
            const lang = await this.getLanguage(ext);

            if (!lang || !this.parser) {
                // Return basic tokens if no language support
                return content.toLowerCase().split(/[^\w]+/).filter(w => w.length > 1);
            }

            this.parser.setLanguage(lang);
            const tree = this.parser.parse(content);
            const tokens: string[] = [];

            const visit = (node: Parser.SyntaxNode) => {
                // Surgical extraction of structural names
                const structuralTypes = [
                    'identifier',
                    'type_identifier',
                    'property_identifier',
                    'function_declaration',
                    'class_declaration',
                    'method_definition',
                    'interface_declaration'
                ];

                if (structuralTypes.includes(node.type)) {
                    // For declarations, we usually want the child 'identifier'
                    if (node.type.endsWith('_declaration') || node.type === 'method_definition') {
                        const nameNode = node.children.find(c => c.type === 'identifier');
                        if (nameNode) {
                            const text = nameNode.text.toLowerCase();
                            if (text.length > 1) tokens.push(text);
                        }
                    } else {
                        const text = node.text.toLowerCase();
                        if (text.length > 1) tokens.push(text);
                    }
                }

                for (const child of node.children) {
                    visit(child);
                }
            };

            visit(tree.rootNode);
            return Array.from(new Set(tokens)); // Unique tokens
        } catch (error) {
            agentLogger.error('Error getting semantic tokens:', error);
            return content.toLowerCase().split(/[^\w]+/).filter(w => w.length > 1);
        }
    }

    private extractTSChunks(node: Parser.SyntaxNode, chunks: CodeChunk[], parentName: string, content: string) {
        let name = '';
        let type: CodeChunk['type'] | null = null;

        switch (node.type) {
            case 'class_declaration':
                type = 'class';
                name = this.getNodeName(node) || 'AnonymousClass';
                break;
            case 'function_declaration':
            case 'arrow_function':
            case 'generator_function_declaration':
                type = 'function';
                name = this.getNodeName(node) || 'AnonymousFunction';
                break;
            case 'method_definition':
                type = 'method';
                name = this.getNodeName(node) || 'AnonymousMethod';
                break;
            case 'interface_declaration':
                type = 'interface';
                name = this.getNodeName(node) || 'AnonymousInterface';
                break;
            case 'type_alias_declaration':
                type = 'type_alias';
                name = this.getNodeName(node) || 'AnonymousType';
                break;
            case 'export_statement':
            case 'lexical_declaration':
            case 'variable_declaration':
                // Specifically ignoring variable declaration unless it involves a function/arrow that deserves chunking
                if (node.type === 'export_statement') {
                    type = 'export';
                }
                break;
            case 'import_statement':
                type = 'import';
                name = 'import'; // generic
                break;
        }

        const fullId = parentName ? `${parentName}.${name}` : name;

        if (type && name) {
            // Create chunk
            chunks.push({
                id: fullId,
                type: type,
                name: name,
                content: node.text,
                startLine: node.startPosition.row + 1,
                endLine: node.endPosition.row + 1,
                dependencies: this.extractDependencies(node, content)
            });
        }

        // Recurse down to find children, mostly for classes/interfaces having methods
        // We only pass the parentName if we're a container like class/interface
        const passParentName = (type === 'class' || type === 'interface') ? fullId : parentName;

        for (const child of node.children) {
            this.extractTSChunks(child, chunks, passParentName, content);
        }
    }

    private getNodeName(node: Parser.SyntaxNode): string | null {
        // Look for name identifier in children
        for (const child of node.children) {
            if (child.type === 'identifier' || child.type === 'property_identifier' || child.type === 'type_identifier') {
                return child.text;
            }
        }
        // Handle variable declarators
        if (node.type === 'variable_declarator') {
            const identifierNode = node.children.find(c => c.type === 'identifier');
            if (identifierNode) return identifierNode.text;
        }
        return null;
    }

    private extractDependencies(node: Parser.SyntaxNode, fileContent: string): string[] {
        const deps = new Set<string>();

        const visit = (n: Parser.SyntaxNode) => {
            // For TS/JS, look for Identifiers being used
            if (n.type === 'identifier' || n.type === 'type_identifier' || n.type === 'property_identifier') {
                deps.add(n.text);
            }
            for (const child of n.children) {
                visit(child);
            }
        };

        visit(node);
        return Array.from(deps);
    }
}
