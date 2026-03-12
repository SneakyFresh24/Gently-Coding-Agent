<script lang="ts">
    import { contextStore } from "../../stores/contextStore";
    import { currentPlan } from "../../stores/taskStore";
    import { X, Layers } from "lucide-svelte";

    $: files = $contextStore.files;
    $: stats = $contextStore.stats;

    function formatTokens(tokens: number): string {
        if (!tokens) return "0";
        if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
        return tokens.toString();
    }

    function getFileColorClass(filename: string): string {
        const ext = filename.split(".").pop()?.toLowerCase();
        switch (ext) {
            case "ts":
            case "js":
                return "bg-blue";
            case "svelte":
            case "vue":
            case "jsx":
            case "tsx":
                return "bg-orange";
            case "css":
            case "scss":
                return "bg-green";
            case "json":
            case "md":
                return "bg-grey";
            default:
                return "bg-blue-light";
        }
    }
</script>

<div class="tracker-container">
    <!-- Header mit Task Info -->
    <div class="tracker-header">
        <span class="task-label">{$currentPlan ? "Task:" : "Context:"}</span>
        <span class="task-title"
            >{$currentPlan?.goal || "Workspace Context"}</span
        >
    </div>

    <!-- File Blocks -->
    {#if files && files.filter((f) => f.inContext).length > 0}
        <div class="blocks-container">
            {#each files.filter((f) => f.inContext) as file}
                <div
                    class="context-block {getFileColorClass(file.path)}"
                    title={file.path.split("/").pop()}
                ></div>
            {/each}
        </div>
    {:else}
        <div class="blocks-container">
            <div class="context-block bg-empty"></div>
            <div class="context-block bg-empty"></div>
        </div>
    {/if}

    <!-- Progress & Stats in einer Zeile -->
    <div class="stats-row">
        <div class="progress-wrapper">
            <div
                class="progress-fill"
                style="width: {Math.min(100, stats?.utilizationPercent || 0)}%"
            ></div>
        </div>
        
        <div class="stats-info">
            <span class="tokens">{formatTokens(stats?.totalTokens || 0)}</span>
            <span class="divider">/</span>
            <span class="tokens-max">{formatTokens(stats?.maxTokens || 0)}</span>
        </div>
        
        <div class="file-count">
            <Layers size={11} />
            <span class="count">{stats?.filesInContext || 0}</span>
        </div>
    </div>
</div>

<style>
    .tracker-container {
        background: rgba(255, 255, 255, 0.03);
        border-radius: 4px;
        padding: 0.5rem;
        border: 1px solid rgba(255, 255, 255, 0.06);
    }

    .tracker-header {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        margin-bottom: 0.5rem;
    }

    .task-label {
        font-size: 0.7rem;
        font-weight: 600;
        opacity: 0.7;
    }

    .task-title {
        font-size: 0.7rem;
        opacity: 0.5;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .blocks-container {
        display: flex;
        flex-wrap: wrap;
        gap: 3px;
        margin-bottom: 0.5rem;
    }

    .context-block {
        height: 12px;
        width: 20px;
        border-radius: 2px;
        opacity: 0.8;
    }

    .bg-blue { background-color: #3b82f6; }
    .bg-blue-light { background-color: #60a5fa; }
    .bg-orange { background-color: #f97316; }
    .bg-green { background-color: #22c55e; }
    .bg-grey { background-color: #64748b; }
    .bg-empty { background-color: rgba(255, 255, 255, 0.1); }

    .stats-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .progress-wrapper {
        flex: 1;
        height: 3px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 2px;
        overflow: hidden;
    }

    .progress-fill {
        height: 100%;
        background: #94a3b8;
        border-radius: 2px;
        transition: width 0.3s ease;
    }

    .stats-info {
        font-size: 0.65rem;
        font-variant-numeric: tabular-nums;
        opacity: 0.6;
    }

    .tokens {
        color: #e2e8f0;
    }

    .divider {
        opacity: 0.4;
    }

    .tokens-max {
        opacity: 0.5;
    }

    .file-count {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        font-size: 0.65rem;
        opacity: 0.5;
        color: #94a3b8;
    }

    .count {
        font-weight: 500;
    }
</style>