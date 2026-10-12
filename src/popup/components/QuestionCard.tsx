import React from 'react';
import { CheckCircle2, Crosshair, HelpCircle, Loader2, Sparkles, XCircle } from 'lucide-react';
import { AnswerReviewItem } from '../../types/answer';

interface QuestionCardProps {
  item: AnswerReviewItem;
  onUpdateAnswer: (answer: string) => void;
  onToggleApproval: () => void;
  onHighlightField: (selector: string) => void;
}

export const QuestionCard: React.FC<QuestionCardProps> = ({
  item,
  onUpdateAnswer,
  onToggleApproval,
  onHighlightField,
}) => {
  const { question, suggestion, userEditedAnswer, approved, fillStatus, fillErrorMessage } = item;

  const formatTypeLabel = (type: string) => {
    switch (type) {
      case 'multiple_choice':
        return 'Multiple Choice';
      case 'fill_in_the_blank':
        return 'Fill In Blank';
      case 'dropdown':
        return 'Dropdown';
      case 'true_false':
        return 'True / False';
      case 'matching':
        return 'Matching';
      default:
        return 'Exercise';
    }
  };

  const confidencePct = suggestion ? Math.round(suggestion.confidence * 100) : 0;
  const isHighConfidence = confidencePct >= 75;

  return (
    <div className="question-card">
      <div className="question-card-header">
        <div className="question-meta">
          <span style={{ fontWeight: 700, fontSize: '13px' }}>#{question.index}</span>
          <span className="badge badge-type">{formatTypeLabel(question.type)}</span>
          {suggestion && (
            <span className={`badge badge-confidence ${!isHighConfidence ? 'low' : ''}`}>
              {confidencePct}% Confidence
            </span>
          )}
        </div>

        {question.fields[0]?.selector && (
          <button
            className="icon-btn"
            style={{ width: '24px', height: '24px' }}
            title="Highlight field on page"
            onClick={() => onHighlightField(question.fields[0].selector)}
          >
            <Crosshair size={13} />
          </button>
        )}
      </div>

      <div className="prompt-text">{question.promptText}</div>

      {question.options && question.options.length > 0 && (
        <div className="options-preview">
          {question.options.map((opt) => (
            <span key={opt.id} className="option-chip" title={`Value: ${opt.value}`}>
              {opt.label}
            </span>
          ))}
        </div>
      )}

      {/* Suggestion & Editing section */}
      {suggestion ? (
        <div className="suggestion-box">
          <div className="suggestion-label">
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Sparkles size={12} /> AI Suggestion
            </span>
          </div>

          <input
            type="text"
            className="editable-answer-input"
            value={userEditedAnswer}
            onChange={(e) => onUpdateAnswer(e.target.value)}
            placeholder="Edit answer before filling..."
          />

          {suggestion.explanation && (
            <div className="explanation-text">
              <strong>Reasoning:</strong> {suggestion.explanation}
            </div>
          )}
        </div>
      ) : (
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <HelpCircle size={14} /> Click "Generate Suggestions" to analyze with AI.
        </div>
      )}

      {/* Bottom Approval & Filling status */}
      <div className="card-actions">
        <label className="approval-toggle">
          <input
            type="checkbox"
            checked={approved}
            onChange={onToggleApproval}
            disabled={!suggestion || fillStatus === 'filling'}
          />
          <span>Approve to fill</span>
        </label>

        <div>
          {fillStatus === 'filling' && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--accent-primary)', fontSize: '11px' }}>
              <Loader2 size={12} className="spin" /> Filling...
            </span>
          )}
          {fillStatus === 'filled' && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--success)', fontSize: '11px', fontWeight: 600 }}>
              <CheckCircle2 size={13} /> Filled
            </span>
          )}
          {fillStatus === 'error' && (
            <span
              style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--danger)', fontSize: '11px' }}
              title={fillErrorMessage}
            >
              <XCircle size={13} /> Failed
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
