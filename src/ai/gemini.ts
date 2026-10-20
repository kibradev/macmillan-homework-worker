import { AIModelInfo, AIProvider, ConnectionTestResult } from '../types/ai';
import { Question } from '../types/question';
import { GenerationResult } from '../types/answer';
import { AI_SYSTEM_PROMPT, buildQuestionsPrompt, parseAndValidateAIResponse } from './base';

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';

/** Errors that mean "this model id is not usable for this key" rather than a transient failure. */
const MODEL_UNAVAILABLE_PATTERN = /no longer available|not found|is not supported|not available to new users/i;

/** Rank a Gemini model id: cheaper/faster tiers first, stable before preview, newer before older. */
export function scoreGeminiModel(id: string): number {
  const tier = /flash-lite/.test(id) ? 3 : /flash/.test(id) ? 2 : /pro/.test(id) ? 1 : 0;
  const stable = /preview|exp|latest/.test(id) ? 0 : 1;
  const version = parseFloat(id.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? '0');
  return tier * 1000 + stable * 100 + version;
}

/** Remember which model replaced an unavailable one for a key, so later calls skip the failing request. */
const resolvedModels = new Map<string, string>();

export class GeminiProvider implements AIProvider {
  readonly id = 'gemini' as const;
  readonly name = 'Google Gemini';

  getAvailableModels(): AIModelInfo[] {
    return [
      {
        id: 'gemini-2.5-flash-lite',
        name: 'Gemini 2.5 Flash Lite (Recommended)',
        description: 'Ultra fast, cost-efficient, latest lightweight model for homework analysis.',
      },
      {
        id: 'gemini-2.0-flash-lite',
        name: 'Gemini 2.0 Flash Lite',
        description: 'High-speed compact model with low latency.',
      },
      {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        description: 'Next-gen high speed flagship model.',
      },
      {
        id: 'gemini-2.0-flash',
        name: 'Gemini 2.0 Flash',
        description: 'Next-gen fast model with improved reasoning capabilities.',
      },
      {
        id: 'gemini-1.5-flash',
        name: 'Gemini 1.5 Flash',
        description: 'Fast, lightweight homework suggestions.',
      },
      {
        id: 'gemini-1.5-pro',
        name: 'Gemini 1.5 Pro',
        description: 'Advanced reasoning for complex passages and writing exercises.',
      },
    ];
  }

  getDefaultModelId(): string {
    return 'gemini-2.5-flash-lite';
  }

  /** Asks Google which text-generation Gemini models this API key can actually use, best first. */
  async listUsableModels(apiKey: string): Promise<string[]> {
    const response = await fetch(`${API_ROOT}/models?pageSize=200&key=${encodeURIComponent(apiKey.trim())}`);
    if (!response.ok) return [];
    const data = await response.json().catch(() => null);
    const models: Array<{ name?: string; supportedGenerationMethods?: string[] }> = data?.models ?? [];
    return models
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => (m.name || '').replace(/^models\//, ''))
      .filter((id) => id.startsWith('gemini-') && !/embedding|tts|image|live|audio|vision|learnlm|robotics|computer-use|aqa/.test(id))
      .sort((a, b) => scoreGeminiModel(b) - scoreGeminiModel(a));
  }

  /**
   * POSTs to generateContent. If the model is rejected as unavailable (e.g. "no longer available to new users"),
   * looks up the models this key can use and retries once with the best one.
   */
  private async postGenerate(
    apiKey: string,
    requestedModel: string,
    body: unknown
  ): Promise<{ response: Response; modelUsed: string }> {
    const key = apiKey.trim();
    const send = (model: string) =>
      fetch(`${API_ROOT}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

    const cacheKey = `${key}:${requestedModel}`;
    const first = resolvedModels.get(cacheKey) || requestedModel;
    const response = await send(first);
    if (response.ok || ![400, 403, 404].includes(response.status)) return { response, modelUsed: first };

    const message: string = (await response.clone().json().catch(() => null))?.error?.message || '';
    if (!MODEL_UNAVAILABLE_PATTERN.test(message)) return { response, modelUsed: first };

    const alternatives = (await this.listUsableModels(key)).filter((m) => m !== first);
    for (const model of alternatives.slice(0, 3)) {
      const retry = await send(model);
      if (retry.ok) {
        resolvedModels.set(cacheKey, model);
        return { response: retry, modelUsed: model };
      }
    }
    return { response, modelUsed: first };
  }

  async testConnection(apiKey: string, modelId: string): Promise<ConnectionTestResult> {
    if (!apiKey.trim()) {
      return { success: false, message: 'Please enter a Gemini API key.' };
    }

    const start = performance.now();

    try {
      const { response, modelUsed } = await this.postGenerate(apiKey, modelId || this.getDefaultModelId(), {
        contents: [{ parts: [{ text: 'Respond with: "OK"' }] }],
        generationConfig: { maxOutputTokens: 10 },
      });

      const elapsed = Math.round(performance.now() - start);

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        const errMsg = errorData?.error?.message || response.statusText;
        return {
          success: false,
          message: `Connection failed (${response.status}): ${errMsg}`,
          latencyMs: elapsed,
        };
      }

      return {
        success: true,
        message: `Successfully connected to Google Gemini (${modelUsed})!`,
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
      throw new Error('Gemini API key is required. Please set it in StudyPilot settings.');
    }

    if (questions.length === 0) {
      return {
        suggestions: [],
        modelUsed: modelId,
        providerId: this.id,
      };
    }

    const promptText = buildQuestionsPrompt(questions);

    const body = {
      systemInstruction: {
        parts: [{ text: AI_SYSTEM_PROMPT }],
      },
      contents: [
        {
          parts: [{ text: promptText }],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    };

    const { response, modelUsed } = await this.postGenerate(apiKey, modelId || this.getDefaultModelId(), body);

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const errMsg = errorData?.error?.message || `HTTP ${response.status} ${response.statusText}`;
      throw new Error(`Gemini API Error: ${errMsg}`);
    }

    const data = await response.json();
    const candidateText =
      data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (!candidateText) {
      throw new Error('Gemini returned an empty response.');
    }

    const suggestions = parseAndValidateAIResponse(candidateText, questions);

    return {
      suggestions,
      rawResponse: candidateText,
      modelUsed,
      providerId: this.id,
      totalTokens: data.usageMetadata?.totalTokenCount,
    };
  }
}
