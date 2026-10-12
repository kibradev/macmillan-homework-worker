import { Question } from './question';

export interface AnswerSuggestion {
  questionId: string;
  suggestedAnswer: string;
  confidence: number; // 0.0 to 1.0
  explanation: string;
  fieldTargetSelector?: string;
}

export type FillStatus = 'idle' | 'filling' | 'filled' | 'error';

export interface AnswerReviewItem {
  question: Question;
  suggestion?: AnswerSuggestion;
  userEditedAnswer: string;
  approved: boolean;
  fillStatus: FillStatus;
  fillErrorMessage?: string;
}

export interface GenerationResult {
  suggestions: AnswerSuggestion[];
  rawResponse?: string;
  modelUsed: string;
  providerId: string;
  totalTokens?: number;
}
