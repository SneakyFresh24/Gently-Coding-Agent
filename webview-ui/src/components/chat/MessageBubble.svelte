<script lang="ts">
  import { onMount } from "svelte";
  import { marked } from "marked";
  import type { Message } from "../../stores/chatStore";
  import FileReference from "../context/FileReference.svelte";
  import CheckpointBadge from "./CheckpointBadge.svelte";

  let { message } = $props<{ message: Message }>();

  let renderedContent = $state("");
  let hljs: any = $state(null);

  // Lazy load highlight.js
  async function ensureHighlighter() {
    if (hljs) return hljs;

    console.log("[Gently] Lazy loading highlight.js...");
    const hljsModule = await import("highlight.js/lib/core");
    const typescript = await import("highlight.js/lib/languages/typescript");
    const javascript = await import("highlight.js/lib/languages/javascript");
    const python = await import("highlight.js/lib/languages/python");
    const json = await import("highlight.js/lib/languages/json");
    const xml = await import("highlight.js/lib/languages/xml");
    const css = await import("highlight.js/lib/languages/css");
    const bash = await import("highlight.js/lib/languages/bash");
    const sql = await import("highlight.js/lib/languages/sql");
    const yaml = await import("highlight.js/lib/languages/yaml");
    const markdown = await import("highlight.js/lib/languages/markdown");

    const hljsInstance = hljsModule.default;
    hljsInstance.registerLanguage("typescript", typescript.default);
    hljsInstance.registerLanguage("javascript", javascript.default);
    hljsInstance.registerLanguage("python", python.default);
    hljsInstance.registerLanguage("json", json.default);
    hljsInstance.registerLanguage("xml", xml.default);
    hljsInstance.registerLanguage("html", xml.default);
    hljsInstance.registerLanguage("css", css.default);
    hljsInstance.registerLanguage("bash", bash.default);
    hljsInstance.registerLanguage("sh", bash.default);
    hljsInstance.registerLanguage("sql", sql.default);
    hljsInstance.registerLanguage("yaml", yaml.default);
    hljsInstance.registerLanguage("yml", yaml.default);
    hljsInstance.registerLanguage("markdown", markdown.default);
    hljsInstance.registerLanguage("md", markdown.default);

    hljs = hljsInstance;
    return hljs;
  }

  // Configure marked setup
  const renderer = new marked.Renderer();

  // Custom code renderer that handles both sync and placeholder for async
  renderer.code = function ({ text, lang }) {
    if (lang && hljs && hljs.getLanguage(lang)) {
      try {
        const highlighted = hljs.highlight(text, { language: lang }).value;
        return `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>`;
      } catch (err) {
        console.error("Highlight error:", err);
      }
    }
    // If not loaded yet, we'll return a placeholder or raw text and re-highlight later
    return `<pre><code>${text}</code></pre>`;
  };

  marked.setOptions({ 
    renderer,
    gfm: true,
    breaks: true
  });

  // Reactive content rendering
  $effect(() => {
    const rawContent = message.content;
    if (!rawContent) {
      renderedContent = "";
      return;
    }

    try {
      // If we have content but no highlighter yet, and it looks like it has code
      if (rawContent.includes("```") && !hljs) {
        ensureHighlighter().then(() => {
          // After highlighter loads, if the content is still the same, re-parse
          if (message.content === rawContent) {
            renderedContent = marked.parse(rawContent) as string;
          }
        });
      }
      
      // Standard parse (might not be highlighted yet, but will be updated by the 'then' above)
      renderedContent = marked.parse(rawContent) as string;
    } catch (err) {
      console.error("Markdown parse error:", err);
      renderedContent = rawContent;
    }
  });

  function copyCode(code: string) {
    navigator.clipboard.writeText(code);
    // TODO: Show toast notification
  }

  onMount(() => {
    // Add copy buttons to code blocks
    const updateCopyButtons = () => {
      const preBlocks = document.querySelectorAll("pre");
      preBlocks.forEach((pre) => {
        if (pre.querySelector(".copy-button")) return; // Skip if already added

        const code = pre.querySelector("code");
        if (!code) return;

        const button = document.createElement("button");
        button.className = "copy-button";
        button.textContent = "Copy";
        button.onclick = () => {
          copyCode(code.textContent || "");
          button.textContent = "Copied!";
          setTimeout(() => {
            button.textContent = "Copy";
          }, 2000);
        };

        pre.appendChild(button);
      });
    };

    // Run initially
    updateCopyButtons();

    // Re-run whenever renderedContent changes (via $effect or similar)
    // Svelte 5 handles this well with $effect, but since we are doing manual DOM manipulation:
  });

  // Re-run copy button logic when content changes
  $effect(() => {
    if (renderedContent) {
      // Wait for tick
      setTimeout(() => {
        const preBlocks = document.querySelectorAll(".message-content pre");
        preBlocks.forEach((pre) => {
          if (pre.querySelector(".copy-button")) return;
          const code = pre.querySelector("code");
          if (!code) return;
          const button = document.createElement("button");
          button.className = "copy-button";
          button.textContent = "Copy";
          button.onclick = () => {
            copyCode(code.textContent || "");
            button.textContent = "Copied!";
            setTimeout(() => {
              button.textContent = "Copy";
            }, 2000);
          };
          pre.appendChild(button);
        });
      }, 0);
    }
  });
</script>

<div
  class="message-bubble animate-fade-in"
  class:user={message.role === "user"}
  class:assistant={message.role === "assistant"}
  class:system={message.isSystemMessage}
  class:streaming={message.isStreaming}
>
  {#if message.role === "assistant" && !message.isSystemMessage}
    <div class="avatar-glow"></div>
  {/if}
  {#if !message.isSystemMessage}
    <!-- Message Header -->
    <div class="message-header">
      <span class="message-role">
        {message.role === "user" ? "You" : "Gently"}
      </span>
      {#if message.checkpoint}
        <CheckpointBadge
          checkpoint={message.checkpoint}
          messageId={message.id}
        />
      {/if}
    </div>
  {/if}

  <!-- File References (for user messages) -->
  {#if message.fileReferences && message.fileReferences.length > 0}
    <div class="file-references">
      {#each message.fileReferences as fileRef}
        <FileReference file={fileRef} />
      {/each}
    </div>
  {/if}

  <!-- Message Content -->
  <div class="message-content">
    {@html renderedContent}
  </div>
</div>

<style>
  .message-bubble {
    padding: 1rem 1.375rem;
    border-radius: 1.5rem;
    margin: 1.25rem 0;
    max-width: 85%;
    position: relative;
    /* Animation handled by animate-fade-in class from app.css */
  }

  .avatar-glow {
    position: absolute;
    top: -10px;
    left: -10px;
    width: 40px;
    height: 40px;
    background: var(--color-primary);
    filter: blur(25px);
    opacity: 0.08;
    pointer-events: none;
    z-index: -1;
  }

  .message-bubble.user {
    background: var(--color-user-message-bg);
    border: 1px solid var(--color-primary-border);
    margin-left: auto;
    margin-right: 0.5rem;
    border-bottom-right-radius: 0.5rem;
    box-shadow: 0 4px 15px rgba(59, 130, 246, 0.1);
  }

  .message-bubble.assistant {
    background: var(--color-assistant-message-bg);
    backdrop-filter: blur(10px);
    border: 1px solid var(--color-border);
    margin-right: auto;
    margin-left: 0.5rem;
    border-bottom-left-radius: 0.5rem;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
  }

  .message-bubble.system {
    background: var(--color-system-message-bg);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(128, 128, 128, 0.2);
    margin: var(--space-sm) auto;
    padding: var(--space-sm) var(--space-md);
    text-align: center;
    font-size: var(--font-sm);
    opacity: 0.8;
    max-width: 90%;
    border-radius: var(--radius-full);
  }

  .message-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.625rem;
    padding-bottom: 0.375rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }

  .message-role {
    font-size: 0.75rem;
    opacity: 0.85;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .message-role::before {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }

  .message-bubble.user .message-role {
    color: var(--color-primary);
  }

  .message-bubble.assistant .message-role {
    color: var(--color-assistant-text, #818cf8);
  }

  .file-references {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-sm);
    margin-bottom: var(--space-sm);
  }

  .message-content {
    line-height: 1.6;
  }

  .message-content :global(pre) {
    background: rgba(40, 44, 52, 0.95);
    padding: var(--space-md);
    border-radius: var(--radius-lg);
    overflow-x: auto;
    margin: var(--space-sm) 0;
    position: relative;
    border: 1px solid var(--color-border);
    box-shadow: var(--shadow-md);
  }

  .message-content :global(code) {
    font-family: "Fira Code", "Cascadia Code", "Courier New", Courier, monospace;
    font-size: var(--font-base);
    line-height: 1.6;
  }

  .message-content :global(pre code) {
    background: none;
    padding: 0;
    display: block;
  }

  .message-content :global(p code) {
    background: var(--color-surface);
    padding: 0.125rem 0.375rem;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    color: rgb(229, 192, 123);
  }

  .message-content :global(p) {
    margin: 0.5rem 0;
  }

  .message-content :global(ul),
  .message-content :global(ol) {
    margin: 0.5rem 0;
    padding-left: 1.5rem;
  }

  .message-content :global(a) {
    color: var(--vscode-textLink-foreground, #4fc3f7);
    text-decoration: none;
  }

  .message-content :global(a:hover) {
    text-decoration: underline;
  }

  /* ===== Tables ===== */
  .message-content :global(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 0.75rem 0;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.5rem;
    overflow: hidden;
    font-size: 0.875rem;
  }

  .message-content :global(thead) {
    background: rgba(255, 255, 255, 0.08);
  }

  .message-content :global(th) {
    padding: 0.6rem 0.75rem;
    text-align: left;
    font-weight: 600;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: rgba(255, 255, 255, 0.85);
    border-bottom: 1px solid rgba(255, 255, 255, 0.15);
  }

  .message-content :global(td) {
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.75);
  }

  .message-content :global(tr:last-child td) {
    border-bottom: none;
  }

  .message-content :global(tbody tr:hover) {
    background: rgba(255, 255, 255, 0.04);
  }

  /* ===== Blockquotes / Callouts ===== */
  .message-content :global(blockquote) {
    margin: 0.75rem 0;
    padding: 0.6rem 1rem;
    background: rgba(255, 255, 255, 0.04);
    border-left: 3px solid rgba(79, 195, 247, 0.6);
    border-radius: 0 0.375rem 0.375rem 0;
    color: rgba(255, 255, 255, 0.8);
    font-style: normal;
  }

  .message-content :global(blockquote p) {
    margin: 0.25rem 0;
  }

  .message-content :global(blockquote strong) {
    color: rgba(255, 255, 255, 0.95);
  }

  /* ===== Horizontal Rules ===== */
  .message-content :global(hr) {
    border: none;
    height: 1px;
    margin: 1rem 0;
    background: linear-gradient(
      90deg,
      transparent,
      rgba(255, 255, 255, 0.15) 20%,
      rgba(255, 255, 255, 0.15) 80%,
      transparent
    );
  }

  /* ===== Headers inside messages ===== */
  .message-content :global(h1) {
    font-size: 1.25rem;
    font-weight: 700;
    margin: 1rem 0 0.5rem;
    padding-bottom: 0.35rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.95);
  }

  .message-content :global(h2) {
    font-size: 1.1rem;
    font-weight: 700;
    margin: 0.9rem 0 0.4rem;
    color: rgba(255, 255, 255, 0.92);
  }

  .message-content :global(h3) {
    font-size: 0.975rem;
    font-weight: 600;
    margin: 0.75rem 0 0.35rem;
    color: rgba(255, 255, 255, 0.88);
  }

  .message-content :global(h4) {
    font-size: 0.9rem;
    font-weight: 600;
    margin: 0.6rem 0 0.3rem;
    color: rgba(255, 255, 255, 0.82);
  }

  /* ===== Strong emphasis ===== */
  .message-content :global(strong) {
    color: rgba(255, 255, 255, 0.95);
    font-weight: 600;
  }

  /* ===== Lists refinement ===== */
  .message-content :global(li) {
    margin-bottom: 0.25rem;
  }

  .message-content :global(li > ul),
  .message-content :global(li > ol) {
    margin-top: 0.25rem;
    margin-bottom: 0;
  }

  /* ===== Task Lists (GFM) ===== */
  .message-content :global(.task-list-item) {
    list-style-type: none;
    margin-left: -1rem;
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .message-content :global(.task-list-item input[type="checkbox"]) {
    margin-top: 0.35rem;
    cursor: default;
    accent-color: var(--color-primary);
  }

  :global(.copy-button) {
    position: absolute;
    top: 0.625rem;
    right: 0.625rem;
    padding: 0.35rem 0.6rem;
    background: rgba(45, 45, 55, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0.5rem;
    color: rgba(255, 255, 255, 0.8);
    font-size: 0.7rem;
    font-weight: 600;
    cursor: pointer;
    z-index: 10;
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    backdrop-filter: blur(8px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    opacity: 0;
  }

  :global(.copy-button:hover) {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: white;
    transform: translateY(-1px);
    box-shadow: 0 6px 16px rgba(59, 130, 246, 0.3);
    opacity: 1 !important;
  }

  :global(.copy-button:active) {
    transform: translateY(0);
  }

  :global(pre:hover .copy-button) {
    opacity: 0.8;
  }
</style>
