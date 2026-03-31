// =====================================================
// Tool Definitions - Single Source of Truth for Schemas
// =====================================================

export const TOOL_DEFINITIONS = {
    // --- File Tools ---
    read_file: {
        name: 'read_file',
        category: 'file',
        description: 'Read a file to understand code or data.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Path to the file relative to workspace root' }
            },
            required: ['path']
        }
    },
    web_search: {
        name: 'web_search',
        category: 'search',
        description: 'Search the web for information using a query. Use this when you need up-to-date information not in your training data or local files.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'The search query' }
            },
            required: ['query']
        }
    },
    search_web: {
        name: 'search_web',
        category: 'search',
        description: 'Alias for web_search.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'The search query' }
            },
            required: ['query']
        }
    },
    write_file: {
        name: 'write_file',
        category: 'file',
        description: `Write content to a file.

IMPORTANT: Always provide parameters in this exact order:
1. path (required) - Provide this FIRST
2. content (required) - Max 50KB per call; split larger files

Example: {"path": "src/file.ts", "content": "..."}`,
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Path to the file (relative to workspace root). ALWAYS provide this FIRST.' },
                content: { type: 'string', description: 'File content. MAXIMUM 50,000 characters. For larger files, split into multiple write_file calls.', maxLength: 50000 }
            },
            required: ['path', 'content']
        }
    },

    safe_edit_file: {
        name: 'safe_edit_file',
        category: 'file',
        description: `Fallback editor for a single simple change in one existing file. Prefer apply_block_edit as the default for existing-file edits.

IMPORTANT:
1. Call read_file on the same file before editing
2. Provide file_path FIRST
3. Then provide new_content
4. Keep new_content under 50KB per call`,
        parameters: {
            type: 'object',
            properties: {
                file_path: { type: 'string', description: 'Path to the file' },
                anchor_line: { type: 'string', description: 'Text of the line to replace' },
                new_content: { type: 'string', description: 'New code content (max 50KB, split larger payloads into multiple calls)', maxLength: 50000 },
                end_anchor: { type: 'string', description: 'Optional end marker for block replacement' },
                line_number_hint: { type: 'number', description: 'Optional 1-based line number' },
                start_line: { type: 'number', description: 'Optional explicit start line' },
                end_line: { type: 'number', description: 'Optional explicit end line' },
                symbol_name: { type: 'string', description: 'Optional AST symbol (e.g. "Class.method")' },
                preview: { type: 'boolean', description: 'If true, only return the diff' },
                allow_fuzzy: { type: 'boolean', description: 'Optional opt-in for fuzzy anchor fallback (default: false).' }
            },
            required: ['file_path', 'new_content']
        }
    },
    apply_block_edit: {
        name: 'apply_block_edit',
        category: 'file',
        description: `Primary edit tool for existing files. Use this by default.

Supports:
- v1 single-file payload: { file_path, edits[] }
- v2 multi-file payload: { file_edits: [{ file_path, edits[] }], mode?, preview_only? }

IMPORTANT:
1. Call read_file before editing each target file
2. Max 8 hunks per file
3. In v2 mode, max 5 files per call`,
        parameters: {
            type: 'object',
            properties: {
                file_path: { type: 'string', description: 'Path to the target file' },
                preview_only: { type: 'boolean', description: 'Generate diff without applying' },
                mode: { type: 'string', enum: ['best-effort', 'atomic'], description: 'Strategy if hunks fail' },
                edits: {
                    type: 'array',
                    maxItems: 8,
                    items: {
                        type: 'object',
                        properties: {
                            old_content: { type: 'string', description: 'EXACT code to replace' },
                            new_content: { type: 'string', description: 'New code content' },
                            context_before: { type: 'string', description: 'Surrounding context (optional)' },
                            context_after: { type: 'string', description: 'Surrounding context (optional)' },
                            reason: { type: 'string', description: 'Why this change is made' }
                        },
                        required: ['old_content', 'new_content', 'reason']
                    }
                },
                file_edits: {
                    type: 'array',
                    maxItems: 5,
                    description: 'v2 payload for multiple files in one call.',
                    items: {
                        type: 'object',
                        properties: {
                            file_path: { type: 'string', description: 'Path to one target file' },
                            edits: {
                                type: 'array',
                                maxItems: 8,
                                items: {
                                    type: 'object',
                                    properties: {
                                        old_content: { type: 'string', description: 'EXACT code to replace' },
                                        new_content: { type: 'string', description: 'New code content' },
                                        context_before: { type: 'string', description: 'Surrounding context (optional)' },
                                        context_after: { type: 'string', description: 'Surrounding context (optional)' },
                                        reason: { type: 'string', description: 'Why this change is made' }
                                    },
                                    required: ['old_content', 'new_content', 'reason']
                                }
                            }
                        },
                        required: ['file_path', 'edits']
                    }
                }
            },
            anyOf: [
                { required: ['file_path', 'edits'] },
                { required: ['file_edits'] }
            ]
        }
    },
    list_files: {
        name: 'list_files',
        category: 'file',
        description: 'List all files in workspace',
        parameters: {
            type: 'object',
            properties: {
                pattern: { type: 'string', description: 'Glob pattern (optional)' }
            }
        }
    },
    find_files: {
        name: 'find_files',
        category: 'file',
        description: 'Find relevant files based on query',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search query' },
                max_results: { type: 'number', description: 'Maximum results (default: 5)' }
            },
            required: ['query']
        }
    },
    regex_search: {
        name: 'regex_search',
        category: 'search',
        description: 'Run fast regex search using a trigram index with RE2 verification and ripgrep fallback.',
        parameters: {
            type: 'object',
            properties: {
                pattern: { type: 'string', description: 'Regex pattern to search for.' },
                path_glob: { type: 'string', description: 'Optional glob filter (for example: "src/**/*.ts").' },
                flags: { type: 'string', description: 'Regex flags (supported: i, m, s, u).' },
                case_sensitive: { type: 'boolean', description: 'Override case sensitivity.' },
                multiline: { type: 'boolean', description: 'Enable multiline behavior where supported.' },
                max_results: { type: 'number', description: 'Maximum number of matches to return.' },
                context_lines: { type: 'number', description: 'Number of context lines around each match.' }
            },
            required: ['pattern']
        }
    },
    check_dev_server: {
        name: 'check_dev_server',
        category: 'file',
        description: 'Check if a development server is already running on common ports (3000, 5173, 8080, etc.). Use this BEFORE starting a dev server with npm run dev/start to avoid "port already in use" errors.',
        parameters: {
            type: 'object',
            properties: {}
        }
    },

    // --- Memory Tools ---
    remember: {
        name: 'remember',
        category: 'memory',
        description: 'Remember important information for future conversations. Use this to store user preferences, codebase patterns, workflow details, or any information that should persist. Supports optional scope restrictions (language, path, file type).',
        parameters: {
            type: 'object',
            properties: {
                content: {
                    type: 'string',
                    description: 'The information to remember'
                },
                category: {
                    type: 'string',
                    enum: ['preference', 'codebase', 'workflow', 'tech-stack', 'general'],
                    description: 'Category of the memory (optional, will be auto-detected if not provided)'
                },
                scope: {
                    type: 'object',
                    description: 'Optional scope restrictions for this memory',
                    properties: {
                        language: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Programming languages (e.g., ["typescript", "javascript"])'
                        },
                        fileExtension: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'File extensions (e.g., [".ts", ".tsx"])'
                        },
                        pathPattern: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Path patterns with wildcards (e.g., ["src/components/*", "tests/*"])'
                        },
                        fileType: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'File types (e.g., ["component", "test", "config"])'
                        }
                    }
                }
            },
            required: ['content']
        }
    },
    recall_memories: {
        name: 'recall_memories',
        category: 'memory',
        description: 'Recall relevant memories based on current context. Use this to retrieve stored information.',
        parameters: {
            type: 'object',
            properties: {
                context: {
                    type: 'string',
                    description: 'Context or query to find relevant memories'
                },
                maxCount: {
                    type: 'number',
                    description: 'Maximum number of memories to retrieve (default: 5)'
                }
            },
            required: ['context']
        }
    },
    update_memory: {
        name: 'update_memory',
        category: 'memory',
        description: 'Update an existing memory with new content. Use this when information has changed or needs correction.',
        parameters: {
            type: 'object',
            properties: {
                memoryId: {
                    type: 'string',
                    description: 'ID of the memory to update'
                },
                newContent: {
                    type: 'string',
                    description: 'New content for the memory'
                },
                category: {
                    type: 'string',
                    enum: ['preference', 'codebase', 'workflow', 'tech-stack', 'general'],
                    description: 'New category (optional)'
                }
            },
            required: ['memoryId', 'newContent']
        }
    },
    deprecate_memory: {
        name: 'deprecate_memory',
        category: 'memory',
        description: 'Mark a memory as deprecated (outdated). Use this when information is no longer valid but you want to keep it for reference.',
        parameters: {
            type: 'object',
            properties: {
                memoryId: {
                    type: 'string',
                    description: 'ID of the memory to deprecate'
                },
                reason: {
                    type: 'string',
                    description: 'Reason for deprecation (optional)'
                },
                supersededBy: {
                    type: 'string',
                    description: 'ID of the memory that replaces this one (optional)'
                }
            },
            required: ['memoryId']
        }
    },
    check_memory_conflicts: {
        name: 'check_memory_conflicts',
        category: 'memory',
        description: 'Check if new information conflicts with existing memories. Use this before adding important information to avoid contradictions.',
        parameters: {
            type: 'object',
            properties: {
                content: {
                    type: 'string',
                    description: 'Content to check for conflicts'
                },
                category: {
                    type: 'string',
                    enum: ['preference', 'codebase', 'workflow', 'tech-stack', 'general'],
                    description: 'Category to check in (optional)'
                }
            },
            required: ['content']
        }
    },
    record_correction: {
        name: 'record_correction',
        category: 'memory',
        description: 'Record a user correction for pattern learning. Use this when the user corrects your output to learn from it.',
        parameters: {
            type: 'object',
            properties: {
                context: {
                    type: 'string',
                    description: 'What were you doing when the correction was made?'
                },
                originalContent: {
                    type: 'string',
                    description: 'What you originally generated'
                },
                correctedContent: {
                    type: 'string',
                    description: 'What the user changed it to'
                },
                fileType: {
                    type: 'string',
                    description: 'File extension (e.g., "ts", "py") - optional'
                },
                filePath: {
                    type: 'string',
                    description: 'File path - optional'
                }
            },
            required: ['context', 'originalContent', 'correctedContent']
        }
    },
    check_pattern_suggestions: {
        name: 'check_pattern_suggestions',
        category: 'memory',
        description: 'Check if there are any pattern-based memory suggestions ready. Use this periodically to see if you should suggest memories to the user.',
        parameters: {
            type: 'object',
            properties: {},
            required: []
        }
    },
    accept_pattern_suggestion: {
        name: 'accept_pattern_suggestion',
        category: 'memory',
        description: 'Accept a pattern suggestion and create a memory from it. Use this after the user confirms they want to remember the pattern.',
        parameters: {
            type: 'object',
            properties: {
                patternId: {
                    type: 'string',
                    description: 'ID of the pattern to accept'
                },
                memoryContent: {
                    type: 'string',
                    description: 'Content for the memory (can be customized from suggestion)'
                },
                category: {
                    type: 'string',
                    enum: ['preference', 'codebase', 'workflow', 'tech-stack', 'general'],
                    description: 'Category for the memory (optional)'
                }
            },
            required: ['patternId', 'memoryContent']
        }
    },
    reject_pattern_suggestion: {
        name: 'reject_pattern_suggestion',
        category: 'memory',
        description: 'Reject a pattern suggestion. Use this when the user does not want to remember the pattern.',
        parameters: {
            type: 'object',
            properties: {
                patternId: {
                    type: 'string',
                    description: 'ID of the pattern to reject'
                }
            },
            required: ['patternId']
        }
    },
    update_memory_bank: {
        name: 'update_memory_bank',
        category: 'memory',
        description: 'Create or update a persistent markdown file in the `.gently/memory-bank/` directory. Use this to permanently store architectural decisions, project rules, or large-scale current focus facts, making them available across all future sessions as Tier-1 Context.',
        parameters: {
            type: 'object',
            properties: {
                filename: {
                    type: 'string',
                    description: 'Name of the markdown file (e.g. "architecture.md", "project_rules.md", "active_context.md")'
                },
                content: {
                    type: 'string',
                    description: 'The updated or new markdown content for this file'
                }
            },
            required: ['filename', 'content']
        }
    },
    query_long_term_memory: {
        name: 'query_long_term_memory',
        category: 'memory',
        description: 'Fetch the contents of specific memory bank files or get a list of all persistent markdown files in the memory bank.',
        parameters: {
            type: 'object',
            properties: {
                filename: {
                    type: 'string',
                    description: 'Optional. Name of the specific markdown file to read (e.g. "architecture.md"). If left empty, a list of all available memory bank files and their entire contents will be returned.'
                }
            }
        }
    },

    // --- Planning Tools ---
    create_plan: {
        name: 'create_plan',
        category: 'planning',
        description: 'Create a structured implementation plan before coding. Include optional file-level architecture hints.',
        parameters: {
            type: 'object',
            properties: {
                goal: {
                    type: 'string',
                    description: 'High-level implementation goal'
                },
                steps: {
                    type: 'array',
                    description: 'Ordered implementation steps',
                    items: {
                        type: 'object',
                        properties: {
                            description: { type: 'string', description: 'Step description' },
                            tool: { type: 'string', description: 'Preferred tool for this step' },
                            parameters: { type: 'object', description: 'Tool parameters for this step' },
                            dependencies: {
                                type: 'array',
                                description: 'Step IDs this step depends on',
                                items: { type: 'string' }
                            }
                        },
                        required: ['description', 'tool', 'parameters']
                    }
                },
                files: {
                    type: 'array',
                    description: 'Optional architecture hints for planned files. Used for file-organization guidance, not strict validation.',
                    items: {
                        type: 'object',
                        properties: {
                            path: { type: 'string', description: 'Target file path' },
                            purpose: { type: 'string', description: 'Why this file exists' },
                            type: {
                                type: 'string',
                                enum: ['html', 'css', 'js', 'ts', 'py', 'rust', 'java', 'json', 'markdown', 'other'],
                                description: 'Generalized file type classification'
                            },
                            estimated_lines: { type: 'number', description: 'Optional rough line estimate' }
                        },
                        required: ['path', 'purpose', 'type']
                    }
                }
            },
            required: ['goal', 'steps']
        }
    },
    handover_to_coder: {
        name: 'handover_to_coder',
        category: 'planning',
        description: 'Switch to Code mode. Call this ONLY after finishing the implementation plan in chat.',
        parameters: {
            type: 'object',
            properties: {
                message: { type: 'string', description: 'Brief summary of the plan for the Coder.' }
            },
            required: ['message']
        }
    },
    ask_question: {
        name: 'ask_question',
        category: 'workflow',
        description: 'Ask the user a question with multiple choice options. Optionally request a mode switch based on the selected option.',
        parameters: {
            type: 'object',
            properties: {
                question: {
                    type: 'string',
                    description: 'The question to ask the user'
                },
                header: {
                    type: 'string',
                    description: 'Optional short header (max 30 chars)'
                },
                options: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            label: { type: 'string', description: 'Display text' },
                            description: { type: 'string', description: 'Optional explanation' },
                            mode: { type: 'string', description: 'Optional target mode (e.g. "code", "architect")' }
                        },
                        required: ['label']
                    }
                },
                multiple: {
                    type: 'boolean',
                    description: 'Allow selecting multiple options'
                }
            },
            required: ['question', 'options']
        }
    },

    // --- Project Tools ---
    analyze_project_structure: {
        name: 'analyze_project_structure',
        category: 'project',
        description: 'Analyze the project structure to understand the codebase layout, tech stack, and file organization.',
        parameters: {
            type: 'object',
            properties: {
                force: { type: 'boolean', description: 'Force re-analysis even if cached (default: false)' }
            }
        }
    },
    get_context: {
        name: 'get_context',
        category: 'project',
        description: 'Get current workspace context',
        parameters: { type: 'object', properties: {} }
    },

    // --- Checkpoint Tools ---
    create_checkpoint: {
        name: 'create_checkpoint',
        category: 'checkpoint',
        description: 'Create a checkpoint before making changes. This allows reverting changes later.',
        parameters: {
            type: 'object',
            properties: {
                messageId: { type: 'string', description: 'ID of the message that triggered this checkpoint' },
                description: { type: 'string', description: 'Description of changes' },
                filePaths: { type: 'array', items: { type: 'string' }, description: 'Array of file paths' }
            },
            required: ['messageId', 'description', 'filePaths']
        }
    },
    restore_checkpoint: {
        name: 'restore_checkpoint',
        category: 'checkpoint',
        description: 'Restore files to a previous checkpoint state',
        parameters: {
            type: 'object',
            properties: {
                checkpointId: { type: 'string', description: 'ID of the checkpoint to restore' },
                mode: {
                    type: 'string',
                    enum: ['files', 'task', 'files&task'],
                    description: 'Restore mode: files only, task history only, or both'
                }
            },
            required: ['checkpointId']
        }
    },
    list_checkpoints: {
        name: 'list_checkpoints',
        category: 'checkpoint',
        description: 'List all available checkpoints',
        parameters: { type: 'object', properties: {} }
    },
    show_checkpoint_diff: {
        name: 'show_checkpoint_diff',
        category: 'checkpoint',
        description: 'Get structured multi-file diff between two checkpoints (or checkpoint vs working directory).',
        parameters: {
            type: 'object',
            properties: {
                fromCheckpointId: { type: 'string', description: 'Base checkpoint ID/commit hash' },
                toCheckpointId: { type: 'string', description: 'Optional target checkpoint ID/commit hash. If omitted, compares against working directory.' }
            },
            required: ['fromCheckpointId']
        }
    },

    // --- Execution Tools ---
    run_command: {
        name: 'run_command',
        category: 'execution',
        description: `Execute a shell command in the project directory. 
Use this tool ONLY for necessary project commands (npm install, git add/commit, pnpm/bun install, npm run build/test, etc.).

IMPORTANT OS AWARENESS (WINDOWS):
- If the user is on Windows, do NOT use Unix-only commands like grep, ls, cat, find, sed, awk.
- Instead, use PowerShell equivalents:
  - grep -r "pattern" path/ -> Get-ChildItem -Recurse path | Select-String "pattern"
  - ls -> Get-ChildItem or dir
  - cat file -> Get-Content file
- Better yet: If you must search, use cross-platform tools like 'rg' (ripgrep) or 'fd' if available (check with 'Get-Command rg' first).
- Command execution uses Node's spawn without a shell, so pipeline operators (|) might require explicit powershell -c "..." wrapping. Use with care.

IMPORTANT:
- No destructive commands without prior consultation (rm -rf /, sudo rm, etc.).
- After modifying package.json, pnpm-lock.yaml, or bun.lockb, you should run the appropriate install command.
- Commands run in the current workspace root.`,
        parameters: {
            type: 'object',
            properties: {
                command: {
                    type: 'string',
                    description: 'The full shell command (e.g., "npm install", "git add . && git commit -m \'fix: ...\'")'
                },
                description: {
                    type: 'string',
                    description: 'Brief explanation of why this command is being executed (for the user and system logs)'
                },
                autoConfirm: {
                    type: 'boolean',
                    description: 'If true, tries to execute without interactive prompt (only for very safe commands)',
                    default: false
                }
            },
            required: ['command', 'description']
        }
    }
} as const;

export type ToolName = keyof typeof TOOL_DEFINITIONS;
