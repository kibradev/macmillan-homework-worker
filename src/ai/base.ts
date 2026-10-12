import { Question } from '../types/question';
import { AnswerSuggestion } from '../types/answer';

export const AI_SYSTEM_PROMPT = `You are StudyPilot, an expert educational homework assistant.
Your goal is to solve academic exercises accurately and explain the reasoning step-by-step.

RULES:
1. Always analyze the question prompt, context, question type, and available options carefully.
2. For multiple choice or dropdown questions, the suggestion must exactly match one of the available options or option values.
3. For fill-in-the-blank questions, provide the exact word or phrase needed with correct spelling, capitalization, and grammar.
4. For true/false questions, output "True" or "False".
5. Return your response as a valid JSON object strictly matching this schema:
{
  "suggestions": [
    {
      "questionId": "string (matching the input question id)",
      "suggestedAnswer": "string (the exact answer to fill)",
      "confidence": number (float between 0.0 and 1.0),
      "explanation": "string (concise 1-2 sentence explanation of why this answer is correct)"
    }
  ]
}
6. Do NOT include markdown code blocks around the JSON if the API supports raw JSON, or ensure the JSON is directly parseable.`;

export function buildQuestionsPrompt(questions: Question[]): string {
  const formattedQuestions = questions.map((q) => {
    return {
      questionId: q.id,
      index: q.index,
      type: q.type,
      promptText: q.promptText,
      context: q.contextText || null,
      options: q.options?.map((o) => ({ label: o.label, value: o.value })) || null,
      fieldsCount: q.fields.length,
    };
  });

  return `Please solve the following homework questions:\n\n${JSON.stringify(formattedQuestions, null, 2)}`;
}

export function parseAndValidateAIResponse(
  rawText: string,
  expectedQuestions: Question[]
): AnswerSuggestion[] {
  let cleaned = rawText.trim();

  // Strip markdown code block fences if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim();
  }

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    // Attempt fallback: regex match for JSON object
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      parsed = JSON.parse(match[0]);
    } else {
      throw new Error(`Failed to parse AI response as JSON: ${(err as Error).message}`);
    }
  }

  const rawList = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.suggestions)
    ? parsed.suggestions
    : parsed?.answers;

  if (!Array.isArray(rawList)) {
    throw new Error('AI response did not contain an array of suggestions.');
  }

  const validSuggestions: AnswerSuggestion[] = [];
  const questionMap = new Map(expectedQuestions.map((q) => [q.id, q]));

  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const qId = String(item.questionId || item.id || '');
    if (!questionMap.has(qId)) {
      // Find by matching order or index if id mismatch
      continue;
    }

    const question = questionMap.get(qId)!;
    const answerStr = String(item.suggestedAnswer ?? item.answer ?? '').trim();
    const confidenceNum = typeof item.confidence === 'number'
      ? Math.max(0, Math.min(1, item.confidence))
      : 0.85;
    const explanationStr = String(item.explanation ?? 'No explanation provided.').trim();

    validSuggestions.push({
      questionId: qId,
      suggestedAnswer: answerStr,
      confidence: confidenceNum,
      explanation: explanationStr,
      fieldTargetSelector: question.fields[0]?.selector,
    });
  }

  // Ensure every question has at least a fallback suggestion if missing
  for (const q of expectedQuestions) {
    const existing = validSuggestions.find((s) => s.questionId === q.id);
    if (!existing) {
      validSuggestions.push({
        questionId: q.id,
        suggestedAnswer: '',
        confidence: 0,
        explanation: 'AI did not return a suggestion for this question.',
        fieldTargetSelector: q.fields[0]?.selector,
      });
    }
  }

  return validSuggestions;
}
