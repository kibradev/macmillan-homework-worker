export type QuestionType =
  | 'multiple_choice'
  | 'fill_in_the_blank'
  | 'dropdown'
  | 'true_false'
  | 'matching'
  | 'unknown';

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
  };
}
