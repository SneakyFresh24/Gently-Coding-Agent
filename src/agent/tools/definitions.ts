// =====================================================
// Tool Definitions - Single Source of Truth for Schemas
// =====================================================

export const TOOL_DEFINITIONS = {
    // --- File Tools ---
    read_file: {
        name: 'read_file',
        category: 'file',
        description: 'Read and examine the content of a file. Use this tool to investigate files, understand code structure, and analyze implementations. This is the PRIMARY tool for examining files - do NOT use apply_block_edit for file investigation.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Path to the file (relative to workspace root)' }
            },
            required: ['path']
        }
    },
    write_file: {
        name: 'write_file',
        category: 'file',
        description: 'Create a new file or overwrite existing file',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Path to the file (relative to workspace root)' },
                content: { type: 'string', description: 'File content' }
            },
            required: ['path', 'content']
        }
    },

    safe_edit_file: {
        name: 'safe_edit_file',
        category: 'file',
        description: `Advanced intelligent file editor (Level 4). Automatically chooses the best matching strategy (Line-Range → AST → Anchor → Fuzzy) to apply code changes. 
        
Features:
- **Line-Range**: Precise replacement if start_line/end_line are known.
- **AST Symbol**: Reliable replacement of functions or classes by name (e.g., "MyComponent.render").
- **Smart Anchor**: Robust matching with trimming and disambiguation via line_number_hint.
- **Fuzzy Fallback**: Matches text even if whitespace or minor characters differ.
- **Guardian Check**: Pre-analysis to prevent destructive or architectural-risk edits.
- **Preview Mode**: Generates a diff without writing to disk.

Parameters:
- file_path: Path to the file.
- anchor_line: (Optional) Text of the line to replace. Use for Small Edits.
- new_content: The complete new code for the block.
- end_anchor: (Optional) Text marking the end of the block.
- line_number_hint: (Optional) 1-based line number for disambiguation.
- start_line / end_line: (Optional) 1-based line numbers for direct replacement (Highest priority).
- symbol_name: (Optional) "ClassName.methodName" or "functionName" for AST-based replacement.
- preview: (Optional) Set to true to see the change without applying it.`,
        parameters: {
            type: 'object',
            properties: {
                file_path: { type: 'string', description: 'Path to the file' },
                anchor_line: { type: 'string', description: 'Start anchor text' },
                new_content: { type: 'string', description: 'New code content' },
                end_anchor: { type: 'string', description: 'End anchor text (for multi-line blocks)' },
                line_number_hint: { type: 'number', description: 'Line number hint (1-based)' },
                start_line: { type: 'number', description: 'Explicit start line (1-based)' },
                end_line: { type: 'number', description: 'Explicit end line (1-based)' },
                symbol_name: { type: 'string', description: 'AST symbol name (e.g. "MyClass.render")' },
                preview: { type: 'boolean', description: 'Preview diff only' }
            },
            required: ['file_path', 'new_content']
        }
    },
    apply_block_edit: {
        name: 'apply_block_edit',
        category: 'file',
        description: `Highly powerful Multi-Hunk Block Editor (Level 5). This is the PRIMARY tool for modifying existing files.
        
Replaces the old SafeEditTool by supporting multiple distinct edits (hunks) in a single tool call. 
It uses an advanced matching algorithm prioritized as follows:
1. Exact normalized match of 'old_content'
2. Fuzzy context match using 'context_before' and 'context_after'

Parameters:
- file_path: Path to the target file.
- preview_only: (Optional) If true, generates diffs but does NOT apply changes. Used to show planned edits to the user.
- mode: (Optional) 'best-effort' (default) applies successful hunks even if others fail. 'atomic' rolls back all changes if any single hunk fails.
- edits: Array of Edit Hunks (Maximum 8).
    Each edit hunk MUST include:
    - id: An optional stable identifier (e.g. "hunk-1") for retrying.
    - old_content: The EXACT old code to replace (Crucial for robust matching).
    - new_content: The new code to insert.
    - start_line_hint / end_line_hint: Approximate context lines for disambiguation.
    - context_before / context_after: 3-5 lines of surrounding context if line numbers have drifted.
    - reason: Brief string explaining this specific hunk (used for Guardian approval).
        
The return format will detailed how many hunks succeeded/failed and provide explicit retry suggestions.`,
        parameters: {
            type: 'object',
            properties: {
                file_path: { type: 'string', description: 'Path to the target file' },
                preview_only: { type: 'boolean', description: 'If true, do not write changes, just return diffs' },
                mode: { type: 'string', enum: ['best-effort', 'atomic'], description: 'Failure mode strategy' },
                edits: {
                    type: 'array',
                    maxItems: 8,
                    description: 'List of individual hunks to apply to the file',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string', description: 'Stable identifier (e.g. "hunk-1")' },
                            old_content: { type: 'string', description: 'The exact old code block' },
                            new_content: { type: 'string', description: 'The new code block' },
                            start_line_hint: { type: 'number', description: 'Approximate start line' },
                            end_line_hint: { type: 'number', description: 'Approximate end line' },
                            context_before: { type: 'string', description: '3-4 lines immediately preceding old_content' },
                            context_after: { type: 'string', description: '3-4 lines immediately following old_content' },
                            reason: { type: 'string', description: 'Why this change is made' }
                        },
                        required: ['old_content', 'new_content', 'reason']
                    }
                }
            },
            required: ['file_path', 'edits']
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
        description: `Create a structured execution plan for complex tasks before execution.

Use this tool when:
- The user request requires multiple steps (e.g., "Create API with tests and register it")
- You need to coordinate changes across multiple files
- The task has clear dependencies between steps

The plan will be shown to the user for approval before execution.`,
        parameters: {
            type: 'object',
            properties: {
                goal: {
                    type: 'string',
                    description: 'High-level goal of the plan (e.g., "Create user profile API with tests")'
                },
                steps: {
                    type: 'array',
                    description: 'Array of steps to execute',
                    items: {
                        type: 'object',
                        properties: {
                            description: {
                                type: 'string',
                                description: 'Human-readable description of what this step does'
                            },
                            tool: {
                                type: 'string',
                                description: 'Name of the tool to execute (e.g., "apply_block_edit", "write_file", "search_files")'
                            },
                            parameters: {
                                type: 'object',
                                description: 'Parameters to pass to the tool'
                            },
                            dependencies: {
                                type: 'array',
                                description: 'Optional: IDs of steps that must complete first (e.g., ["step-1", "step-2"])',
                                items: { type: 'string' }
                            }
                        },
                        required: ['description', 'tool', 'parameters']
                    }
                }
            },
            required: ['goal', 'steps']
        }
    },
    execute_plan: {
        name: 'execute_plan',
        category: 'planning',
        description: `Execute a previously created plan step-by-step.

This tool will:
1. Execute each step in order (respecting dependencies)
2. Validate results after each step
3. Stop and report if a step fails
4. Return results to you for analysis`,
        parameters: {
            type: 'object',
            properties: {
                planId: { type: 'string', description: 'ID of the plan to execute' },
                autoRetry: { type: 'boolean', description: 'Automatically retry failed steps (default: false)' },
                maxRetries: { type: 'number', description: 'Maximum retries per step (default: 3)' }
            },
            required: ['planId']
        }
    },
    handover_to_coder: {
        name: 'handover_to_coder',
        category: 'planning',
        description: `Submit the plan and hand over execution to the Code mode. Call this ONLY when you have fully finished creating the detailed plan.`,
        parameters: {
            type: 'object',
            properties: {
                planId: { type: 'string', description: 'The ID of the plan you created.' },
                message: { type: 'string', description: 'An optional message to pass to the coder agent.' }
            },
            required: ['planId']
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
                checkpointId: { type: 'string', description: 'ID of the checkpoint to restore' }
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

    // --- Verification Tools ---
    verify_and_auto_fix: {
        name: 'verify_and_auto_fix',
        category: 'verification',
        description: `Run a terminal command. If it fails, an autonomous Verification Agent will intercept the error, analyze it, fix the files, and re-run until success.`,
        parameters: {
            type: 'object',
            properties: {
                command: { type: 'string', description: 'The shell command to run' },
                max_retries: { type: 'number', description: 'Maximum self-healing attempts (default: 3)' }
            },
            required: ['command']
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
                    description: 'Brief explanation of why this command is being executed (for the User and Guardian)'
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
