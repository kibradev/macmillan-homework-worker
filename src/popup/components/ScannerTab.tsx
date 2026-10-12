import React from 'react';
import { ArrowDownToLine, CheckCheck, Loader2, Play, RefreshCw, Sparkles } from 'lucide-react';
import { AnswerReviewItem } from '../../types/answer';
import { QuestionCard } from './QuestionCard';

interface ScannerTabProps {
  items: AnswerReviewItem[];
  isScanning: boolean;
  isGenerating: boolean;
  isFilling: boolean;
  hasApiKey: boolean;
  activeProviderName: string;
  onScan: () => void;
  onGenerate: () => void;
  onFillApproved: () => void;
  onUpdateAnswer: (index: number, answer: string) => void;
  onToggleApproval: (index: number) => void;
  onToggleAllApprovals: () => void;
  onHighlightField: (selector: string) => void;
  onOpenSettings: () => void;
}

export const ScannerTab: React.FC<ScannerTabProps> = ({
  items,
  isScanning,
  isGenerating,
  isFilling,
  hasApiKey,
  activeProviderName,
  onScan,
  onGenerate,
  onFillApproved,
  onUpdateAnswer,
  onToggleApproval,
  onToggleAllApprovals,
  onHighlightField,
  onOpenSettings,
}) => {
  const approvedCount = items.filter((i) => i.approved).length;
  const suggestionsCount = items.filter((i) => !!i.suggestion).length;
  const allApproved = items.length > 0 && items.every((i) => i.approved);

  return (
    <div className="tab-content">
      {/* Top action row */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          className="btn btn-primary"
          style={{ flex: 1 }}
          onClick={onScan}
          disabled={isScanning || isGenerating || isFilling}
        >
          {isScanning ? (
            <>
              <Loader2 size={15} className="spin" /> Scanning DOM...
            </>
          ) : (
            <>
              <RefreshCw size={15} /> Scan Homework
            </>
          )}
        </button>

        {items.length > 0 && (
          <button
            className="btn btn-secondary"
            onClick={onGenerate}
            disabled={isGenerating || isScanning || isFilling}
            title={hasApiKey ? `Generate with ${activeProviderName}` : 'Set API key in Settings first'}
          >
            {isGenerating ? (
              <>
                <Loader2 size={15} className="spin" /> Thinking...
              </>
            ) : (
              <>
                <Sparkles size={15} /> Suggestions
              </>
            )}
          </button>
        )}
      </div>

      {!hasApiKey && items.length > 0 && (
        <div className="banner banner-warning">
          <span>No API key configured for {activeProviderName}.</span>
          <button
            className="btn btn-sm btn-secondary"
            style={{ marginLeft: 'auto' }}
            onClick={onOpenSettings}
          >
            Configure
          </button>
        </div>
      )}

      {/* Main Questions View */}
      {items.length === 0 ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '30px 20px',
            color: 'var(--text-secondary)',
            gap: '12px',
          }}
        >
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              background: 'var(--bg-secondary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent-primary)',
            }}
          >
            <Play size={22} />
          </div>
          <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>
            Ready to Analyze Homework
          </div>
          <p style={{ fontSize: '12px', maxWidth: '280px', lineHeight: 1.5 }}>
            Navigate to an exercise on Macmillan or open the mock homework page, then click{' '}
            <strong>Scan Homework</strong> to extract questions.
          </p>
        </div>
      ) : (
        <>
          {/* Controls bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 0',
              borderBottom: '1px solid var(--border-color)',
              fontSize: '12px',
              color: 'var(--text-secondary)',
            }}
          >
            <span>
              <strong>{items.length}</strong> questions detected ({approvedCount} approved)
            </span>

            {suggestionsCount > 0 && (
              <button
                className="btn btn-sm btn-secondary"
                onClick={onToggleAllApprovals}
                style={{ fontSize: '11px', padding: '3px 8px' }}
              >
                <CheckCheck size={12} />
                {allApproved ? 'Deselect All' : 'Approve All'}
              </button>
            )}
          </div>

          {/* Question List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {items.map((item, idx) => (
              <QuestionCard
                key={item.question.id}
                item={item}
                onUpdateAnswer={(val) => onUpdateAnswer(idx, val)}
                onToggleApproval={() => onToggleApproval(idx)}
                onHighlightField={onHighlightField}
              />
            ))}
          </div>

          {/* Bottom Fill Button */}
          <div
            style={{
              position: 'sticky',
              bottom: '-16px',
              background: 'var(--bg-primary)',
              padding: '12px 0 6px 0',
              borderTop: '1px solid var(--border-color)',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            <button
              className="btn btn-success"
              style={{ width: '100%', padding: '10px 16px' }}
              onClick={onFillApproved}
              disabled={approvedCount === 0 || isFilling || isGenerating}
            >
              {isFilling ? (
                <>
                  <Loader2 size={16} className="spin" /> Filling Approved Fields...
                </>
              ) : (
                <>
                  <ArrowDownToLine size={16} /> Fill {approvedCount} Approved Answer
                  {approvedCount === 1 ? '' : 's'}
                </>
              )}
            </button>
            <span
              style={{
                fontSize: '10px',
                color: 'var(--text-muted)',
                textAlign: 'center',
              }}
            >
              Assignments are never submitted automatically. Review all fields before submission.
            </span>
          </div>
        </>
      )}
    </div>
  );
};
