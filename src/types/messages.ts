import { Question } from './question';
import { PlatformDetectionResult } from './platform';

export type ActionType =
  | 'DETECT_PLATFORM'
  | 'SCAN_QUESTIONS'
  | 'FILL_APPROVED_ANSWER'
  | 'HIGHLIGHT_FIELD'
  | 'PING_CONTENT_SCRIPT';

export interface BaseMessage {
  action: ActionType;
}

export interface DetectPlatformMessage extends BaseMessage {
  action: 'DETECT_PLATFORM';
}

export interface ScanQuestionsMessage extends BaseMessage {
  action: 'SCAN_QUESTIONS';
}

export interface FillApprovedAnswerMessage extends BaseMessage {
  action: 'FILL_APPROVED_ANSWER';
  question: Question;
  answer: string;
}

export interface HighlightFieldMessage extends BaseMessage {
  action: 'HIGHLIGHT_FIELD';
  selector: string;
}

export interface PingMessage extends BaseMessage {
  action: 'PING_CONTENT_SCRIPT';
}

export type ExtensionRequestMessage =
  | DetectPlatformMessage
  | ScanQuestionsMessage
  | FillApprovedAnswerMessage
  | HighlightFieldMessage
  | PingMessage;

export interface DetectPlatformResponse {
  success: boolean;
  data?: PlatformDetectionResult;
  error?: string;
}

export interface ScanQuestionsResponse {
  success: boolean;
  questions?: Question[];
  platform?: PlatformDetectionResult;
  error?: string;
}

export interface FillApprovedAnswerResponse {
  success: boolean;
  filled: boolean;
  error?: string;
}
