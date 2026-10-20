export type QuestionType =
  | 'multiple_choice'
  | 'fill_in_the_blank'
  | 'dropdown'
  | 'true_false'
  | 'matching'
  | 'multiple_select'
  | 'unknown';

/** Separates the option texts of a multiple_select answer, e.g. "Option A || Option C". */
export const MULTI_ANSWER_SEPARATOR = ' || ';

export interface AnswerOption {
  id: string;
  label: string;
  value: string;
  elementSelector?: string;
}

export interface FormFieldRef {
  id: string;
  selector: string;
  fieldType: 'input' | 'textarea' | 'select' | 'radio' | 'checkbox';
  name?: string;
  placeholder?: string;
  currentValue?: string;
  label?: string;
}

export interface Question {
  id: string;
  index: number;
  type: QuestionType;
  promptText: string;
  contextText?: string;
  options?: AnswerOption[];
  fields: FormFieldRef[];
  metadata?: {
    platformSpecificId?: string;
    containerSelector?: string;
    sectionTitle?: string;
    audioUrl?: string;
    audioTranscript?: string;
    isListening?: boolean;
    isInsideIframe?: boolean;
    /** multiple_select: exact number of options the activity wants ticked (data-rcfrestrict). */
    selectCount?: number;
  };
}
