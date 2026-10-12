import { Question } from './question';
import { GenerationResult } from './answer';

export type AIProviderId = 'gemini' | 'openai' | 'anthropic';

export interface AIModelInfo {
  id: string;
  name: string;
  description: string;
  contextWindow?: string;
}

export interface AIProviderConfig {
  providerId: AIProviderId;
  apiKey: string;
  modelId: string;
  customEndpoint?: string;
  saveKeyToSessionOnly: boolean;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  latencyMs?: number;
}

export interface AIProvider {
  readonly id: AIProviderId;
  readonly name: string;
  getAvailableModels(): AIModelInfo[];
  getDefaultModelId(): string;
  testConnection(apiKey: string, modelId: string): Promise<ConnectionTestResult>;
  generateAnswers(
    questions: Question[],
    apiKey: string,
    modelId: string
  ): Promise<GenerationResult>;
}
