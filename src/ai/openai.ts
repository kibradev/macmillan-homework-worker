import { AIModelInfo, AIProvider, ConnectionTestResult } from '../types/ai';
import { Question } from '../types/question';
import { GenerationResult } from '../types/answer';
import { AI_SYSTEM_PROMPT, buildQuestionsPrompt, parseAndValidateAIResponse } from './base';

export class OpenAIProvider implements AIProvider {
  readonly id = 'openai' as const;
  readonly name = 'OpenAI';

  getAvailableModels(): AIModelInfo[] {
    return [
      {
        id: 'gpt-4o-mini',
        name: 'GPT-4o mini (Recommended)',
        description: 'Fast, cost-effective, great for quick homework tasks.',
      },
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        description: 'Flagship multimodal model with superior reasoning.',
      },
      {
        id: 'gpt-3.5-turbo',
        name: 'GPT-3.5 Turbo',
        description: 'Legacy fast model for basic multiple-choice exercises.',
      },
    ];
  }

  getDefaultModelId(): string {
    return 'gpt-4o-mini';
  }

  async testConnection(apiKey: string, modelId: string): Promise<ConnectionTestResult> {
    if (!apiKey.trim()) {
      return { success: false, message: 'Please enter an OpenAI API key.' };
    }

    const start = performance.now();
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: modelId || this.getDefaultModelId(),
          messages: [{ role: 'user', content: 'Say OK' }],
          max_tokens: 5,
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
        message: 'Successfully connected to OpenAI!',
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
      throw new Error('OpenAI API key is required. Please set it in StudyPilot settings.');
    }

    if (questions.length === 0) {
      return {
        suggestions: [],
        modelUsed: modelId,
        providerId: this.id,
      };
    }

    const promptText = buildQuestionsPrompt(questions);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: modelId || this.getDefaultModelId(),
        messages: [
          { role: 'system', content: AI_SYSTEM_PROMPT },
          { role: 'user', content: promptText },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => null);
      const errMsg = errJson?.error?.message || `HTTP ${response.status} ${response.statusText}`;
      throw new Error(`OpenAI API Error: ${errMsg}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    if (!content) {
      throw new Error('OpenAI returned an empty response.');
    }

    const suggestions = parseAndValidateAIResponse(content, questions);

    return {
      suggestions,
      rawResponse: content,
      modelUsed: modelId || this.getDefaultModelId(),
      providerId: this.id,
      totalTokens: data.usage?.total_tokens,
    };
  }
}
