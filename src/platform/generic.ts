import { PlatformAdapter, PlatformId } from '../types/platform';
import { Question } from '../types/question';
import { extractQuestionsFromGenericDOM } from '../extractor/dom-scanner';
import { fillFormField } from '../filler/form-filler';

export class GenericPlatformAdapter implements PlatformAdapter {
  readonly id: PlatformId = 'generic';
  readonly name = 'Generic Homework Page';

  isPlatformPage(_url: string, _doc: Document): boolean {
    // Generic fallback matches any webpage
    return true;
  }

  detectExercise(doc: Document): boolean {
    const inputs = doc.querySelectorAll('input:not([type="hidden"]), select, textarea');
    return inputs.length > 0;
  }

  async extractQuestions(doc: Document): Promise<Question[]> {
    return extractQuestionsFromGenericDOM(doc);
  }

  async fillAnswer(doc: Document, question: Question, answer: string): Promise<{ success: boolean; error?: string }> {
    return fillFormField(doc, question, answer);
  }
}
