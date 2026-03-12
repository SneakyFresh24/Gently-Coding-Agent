import { extensionSync } from "./extensionSync";
import { chatStore, type FileReference } from "../stores/chatStore";
import { realtimeStore } from "../stores/realtimeStore";

/**
 * Centralized service for high-level chat actions.
 * Decouples components from direct extensionSync calls and store mutations.
 */
export const chatActions = {
    /**
     * Sends a user message to the extension.
     */
    async sendMessage(message: string, fileReferences: FileReference[] = []) {
        if (!message.trim()) return;

        chatStore.addUserMessage(message.trim(), fileReferences);
        extensionSync.send("sendMessage", {
            message: message.trim(),
            fileReferences
        });
    },

    /**
     * Triggers prompt enhancement logic in the extension.
     */
    async enhancePrompt(prompt: string) {
        if (!prompt.trim()) return;
        extensionSync.send("enhancePrompt", { prompt: prompt.trim() });
    },

    /**
     * Stops the current message generation.
     */
    async stopGeneration() {
        extensionSync.send("stopMessage", {});
        realtimeStore.setGenerating(false);
    },

    /**
     * Reverts the project to a specific checkpoint.
     */
    async revertCheckpoint(checkpointId: string, messageId: string) {
        extensionSync.send("revertCheckpoint", {
            checkpointId,
            messageId
        });
    },

    /**
     * Opens the memories panel.
     */
    async openMemories() {
        extensionSync.send("openMemories", {});
    },

    /**
     * Shows the validation error dialog.
     */
    async showValidationError(error: string) {
        chatStore.setError(error);
        realtimeStore.setShowValidationDialog(true);
    }
};
