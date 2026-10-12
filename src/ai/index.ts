import { AIProvider, AIProviderId } from '../types/ai';
import { GeminiProvider } from './gemini';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';

const providers: Record<AIProviderId, AIProvider> = {
  gemini: new GeminiProvider(),
  openai: new OpenAIProvider(),
  anthropic: new AnthropicProvider(),
};

export function getAIProvider(id: AIProviderId): AIProvider {
  const provider = providers[id];
  if (!provider) {
    throw new Error(`Unsupported AI provider: ${id}`);
  }
  return provider;
}

export function getAllAIProviders(): AIProvider[] {
  return Object.values(providers);
}

export { GeminiProvider, OpenAIProvider, AnthropicProvider };
