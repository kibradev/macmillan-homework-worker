import { AIModelInfo, AIProvider, ConnectionTestResult } from '../types/ai';
import { Question } from '../types/question';
import { GenerationResult } from '../types/answer';
import { AI_SYSTEM_PROMPT, buildQuestionsPrompt, parseAndValidateAIResponse } from './base';

export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic' as const;
  readonly name = 'Anthropic Claude';

  getAvailableModels(): AIModelInfo[] {
    return [
      {
        id: 'claude-3-5-haiku-20241022',
        name: 'Claude 3.5 Haiku (Fast & Recommended)',
        description: 'Blazing fast, highly capable compact model for homework analysis.',
      },
      {
        id: 'claude-3-5-sonnet-20241022',
        name: 'Claude 3.5 Sonnet',
        description: 'Industry-leading intelligence and nuanced language analysis.',
      },
    ];
  }

  getDefaultModelId(): string {
    return 'claude-3-5-haiku-20241022';
  }

  async testConnection(apiKey: string, modelId: string): Promise<ConnectionTestResult> {
    if (!apiKey.trim()) {
      return { success: false, message: 'Please enter an Anthropic API key.' };
    }

    const start = performance.now();
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey.trim(),
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: modelId || this.getDefaultModelId(),
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Reply with OK' }],
        }),
      });

      const elapsed = Math.round(performance.now() - start);

      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        const errMsg = errJson?.error?.message || response.statusText;
        return {
          success: false,
          message: `Connection failed (${response.status}): ${errMsg}`,
          latencyMs: elapsed,
        };
      }

      return {
        success: true,
        message: 'Successfully connected to Anthropic Claude!',
        latencyMs: elapsed,
      };
    } catch (err) {
      return {
        success: false,
        message: `Network error: ${(err as Error).message}`,
      };
    }
  }

  async generateAnswers(
    questions: Question[],
    apiKey: string,
    modelId: string
  ): Promise<GenerationResult> {
    if (!apiKey.trim()) {
      throw new Error('Anthropic API key is required. Please set it in StudyPilot settings.');
    }

    if (questions.length === 0) {
      return {
        suggestions: [],
        modelUsed: modelId,
        providerId: this.id,
      };
    }

    const promptText = buildQuestionsPrompt(questions);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey.trim(),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: modelId || this.getDefaultModelId(),
        system: AI_SYSTEM_PROMPT,
        max_tokens: 2048,
        messages: [{ role: 'user', content: promptText }],
      }),
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => null);
      const errMsg = errJson?.error?.message || `HTTP ${response.status} ${response.statusText}`;
      throw new Error(`Anthropic API Error: ${errMsg}`);
    }

    const data = await response.json();
    const content = data.content?.[0]?.text || '';

    if (!content) {
      throw new Error('Anthropic returned an empty response.');
    }

    const suggestions = parseAndValidateAIResponse(content, questions);

    return {
      suggestions,
      rawResponse: content,
      modelUsed: modelId || this.getDefaultModelId(),
      providerId: this.id,
      totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
    };
  }
}
