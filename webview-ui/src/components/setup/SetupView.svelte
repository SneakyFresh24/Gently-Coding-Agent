<script lang="ts">
    import { onMount } from "svelte";
    import { extensionSync } from "../../lib/extensionSync";
    import { extensionEvents } from "../../lib/extensionEvents";

    const OPENROUTER_PREFIX = "sk-or-";

    let apiKey = $state("");
    let isLoading = $state(false);
    let errorMessage = $state("");

    function handleSubmit() {
        if (!apiKey) {
            errorMessage = "Please enter an API key";
            return;
        }

        if (!apiKey.startsWith(OPENROUTER_PREFIX)) {
            errorMessage = `OpenRouter API keys usually start with "${OPENROUTER_PREFIX}". Please double check your key.`;
        }

        isLoading = true;
        errorMessage = "";

        extensionSync.send("setApiKey", {
            key: apiKey.trim(),
        });
    }

    onMount(() => {
        return extensionEvents.init({
            onApiKeyStatus: (status) => {
                isLoading = false;
                if (status.error) {
                    errorMessage = status.error;
                }
            },
        });
    });
</script>

<div class="flex items-center justify-center w-full h-full p-8">
    <div
        class="glass rounded-2xl p-8 w-full max-w-md animate-fade-in animate-slide-up"
    >
        <!-- Logo/Title -->
        <div class="text-center mb-8">
            <h1 class="text-3xl font-bold mb-2">Gently</h1>
            <p class="text-sm opacity-70">AI Coding Agent</p>
        </div>

        <div class="mb-6 text-sm opacity-80 text-center">
            <p>
                Welcome to Gently! To get started, please provide your <a
                    href="https://openrouter.ai/keys"
                    class="text-blue-400 hover:text-blue-300 underline"
                    target="_blank">OpenRouter API key</a
                >.
            </p>
        </div>

        <!-- Form -->
        <form
            onsubmit={handleSubmit}
            class="space-y-4 form-content"
            style="overflow: visible;"
        >
            <div>
                <label for="apiKey" class="block text-sm font-medium mb-2">
                    OpenRouter API Key
                </label>
                <input
                    id="apiKey"
                    type="password"
                    bind:value={apiKey}
                    placeholder="sk-or-..."
                    class="w-full px-4 py-2 rounded-lg glass-dark focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-mono text-sm"
                    disabled={isLoading}
                />
            </div>

            <!-- Error Message -->
            {#if errorMessage}
                <div
                    class="p-3 rounded-lg bg-red-500/20 border border-red-500/30 text-red-400 text-sm animate-slide-in error-message"
                >
                    {errorMessage}
                </div>
            {/if}

            <!-- Submit Button -->
            <button
                type="submit"
                disabled={isLoading || !apiKey}
                class="w-full py-3 rounded-lg font-medium transition-all
               bg-blue-600 hover:bg-blue-700 active:scale-95
               disabled:opacity-50 disabled:cursor-not-allowed mt-4"
            >
                {#if isLoading}
                    <span class="inline-block animate-pulse">Saving...</span>
                {:else}
                    Save API Key & Start Chatting
                {/if}
            </button>
        </form>
    </div>
</div>

<style>
    @keyframes slide-up {
        from {
            opacity: 0;
            transform: translateY(20px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    @keyframes shake {
        0%,
        100% {
            transform: translateX(0);
        }
        10%,
        30%,
        50%,
        70%,
        90% {
            transform: translateX(-5px);
        }
        20%,
        40%,
        60%,
        80% {
            transform: translateX(5px);
        }
    }

    @keyframes fade-in {
        from {
            opacity: 0;
            transform: scale(0.9);
        }
        to {
            opacity: 1;
            transform: scale(1);
        }
    }

    .animate-slide-up {
        animation: slide-up 0.6s ease-out;
    }

    .animate-fade-in {
        animation: fade-in 0.4s ease-out;
    }

    .glass {
        background: rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        transition: all 0.3s ease;
    }

    .glass-dark {
        background: rgba(0, 0, 0, 0.3);
        border: 1px solid rgba(255, 255, 255, 0.1);
        transition: all 0.3s ease;
    }

    .glass-dark:focus {
        background: rgba(0, 0, 0, 0.4);
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.3);
    }

    input:focus {
        outline: none;
        transform: scale(1.01);
        overflow: visible;
    }

    input {
        overflow: visible;
        margin: 0;
        padding: 0.5rem 1rem;
    }

    button:active {
        transform: scale(0.95);
    }

    .error-message {
        animation: shake 0.5s ease-in-out;
    }
</style>
