import { AIModelInfo, AIProvider, ConnectionTestResult } from '../types/ai';
import { Question } from '../types/question';
import { GenerationResult } from '../types/answer';
import { AI_SYSTEM_PROMPT, buildQuestionsPrompt, parseAndValidateAIResponse } from './base';

export class GeminiProvider implements AIProvider {
  readonly id = 'gemini' as const;
  readonly name = 'Google Gemini';

  getAvailableModels(): AIModelInfo[] {
    return [
      {
        id: 'gemini-1.5-flash',
        name: 'Gemini 1.5 Flash (Fast & Recommended)',
        description: 'High speed, lightweight, ideal for instant homework suggestions.',
      },
      {
        id: 'gemini-2.0-flash',
        name: 'Gemini 2.0 Flash',
        description: 'Next-gen fast model with improved reasoning capabilities.',
      },
      {
        id: 'gemini-1.5-pro',
        name: 'Gemini 1.5 Pro',
        description: 'Advanced reasoning for complex passages and writing exercises.',
      },
    ];
  }

  getDefaultModelId(): string {
    return 'gemini-1.5-flash';
  }

  async testConnection(apiKey: string, modelId: string): Promise<ConnectionTestResult> {
    if (!apiKey.trim()) {
      return { success: false, message: 'Please enter a Gemini API key.' };
    }

    const start = performance.now();
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      modelId || this.getDefaultModelId()
    )}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Respond with: "OK"' }] }],
          generationConfig: { maxOutputTokens: 10 },
        }),
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
        message: 'Successfully connected to Google Gemini!',
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

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      modelId || this.getDefaultModelId()
    )}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;

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

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

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
      modelUsed: modelId || this.getDefaultModelId(),
      providerId: this.id,
      totalTokens: data.usageMetadata?.totalTokenCount,
    };
  }
}
