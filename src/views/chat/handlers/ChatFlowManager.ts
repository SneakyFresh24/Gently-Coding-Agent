import { QueryEngine, EmptyAssistantResponseError } from '../runtime/QueryEngine';

export { EmptyAssistantResponseError };

// Thin compatibility adapter: ChatFlowManager now delegates to the canonical QueryEngine runtime.
export class ChatFlowManager extends QueryEngine {}
