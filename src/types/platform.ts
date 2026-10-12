import { Question } from './question';

export type PlatformId = 'macmillan' | 'generic';

export interface PlatformDetectionResult {
  id: PlatformId;
  name: string;
  isPlatformPage: boolean;
  hasExercise: boolean;
  confidence: number;
  reason: string;
}

export interface PlatformAdapter {
  readonly id: PlatformId;
  readonly name: string;
  isPlatformPage(url: string, doc: Document): boolean;
  detectExercise(doc: Document): boolean;
  extractQuestions(doc: Document): Promise<Question[]>;
  fillAnswer(doc: Document, question: Question, answer: string): Promise<boolean>;
}
