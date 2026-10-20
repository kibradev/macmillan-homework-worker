import React from 'react';
import { ArrowDownToLine, CheckCheck, ClipboardList, Code2, Loader2, Play, RefreshCw, Sparkles, Zap } from 'lucide-react';
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
  onClear?: () => void;
  onAutoPilot: () => void;
  onDiagnose?: () => void;
  onSnapshot?: () => void;
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
  onClear,
  onAutoPilot,
  onDiagnose,
  onSnapshot,
}) => {
  const approvedCount = items.filter((i) => i.approved).length;
  const suggestionsCount = items.filter((i) => !!i.suggestion).length;
  const allApproved = items.length > 0 && items.every((i) => i.approved);

  return (
    <div className="tab-content">
      {/* 1-Click Auto-Pilot Button */}
      <button
        className="btn btn-primary"
        style={{
          width: '100%',
          padding: '11px 16px',
          fontWeight: 700,
          letterSpacing: '0.3px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          fontSize: '13px',
        }}
        onClick={onAutoPilot}
        disabled={isScanning || isGenerating || isFilling}
      >
        {isScanning ? (
          <>
            <Loader2 size={15} className="spin" /> 1/3 Sayfa Taranıyor...
          </>
        ) : isGenerating ? (
          <>
            <Loader2 size={15} className="spin" /> 2/3 AI Çözüyor...
          </>
        ) : isFilling ? (
          <>
            <Loader2 size={15} className="spin" /> 3/3 Sayfaya İşaretleniyor...
          </>
        ) : (
          <>
            <Zap size={15} /> ⚡ Auto-Pilot (Tara, Çöz & İşaretle)
          </>
        )}
      </button>

      {(onDiagnose || onSnapshot) && (
        <div style={{ display: 'flex', gap: '8px' }}>
          {onDiagnose && (
            <button
              className="btn btn-secondary"
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
              onClick={onDiagnose}
              title="Sayfadaki Macmillan bileşenlerini analiz edip raporu panoya kopyalar"
            >
              <ClipboardList size={14} /> Tanı Raporu
            </button>
          )}
          {onSnapshot && (
            <button
              className="btn btn-secondary"
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
              onClick={onSnapshot}
              title="Etkinliğin temizlenmiş HTML'ini panoya kopyalar (yeni soru tiplerini desteklemek için)"
            >
              <Code2 size={14} /> HTML Kopyala
            </button>
          )}
        </div>
      )}

      {/* Secondary granular action row */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          className="btn btn-secondary"
          style={{ flex: 1 }}
          onClick={onScan}
          disabled={isScanning || isGenerating || isFilling}
        >
          {isScanning ? (
            <>
              <Loader2 size={15} className="spin" /> Taranıyor...
            </>
          ) : (
            <>
              <RefreshCw size={14} /> Scan Only
            </>
          )}
        </button>

        {items.length > 0 && (
          <>
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

            {onClear && (
              <button
                className="icon-btn"
                style={{ width: '36px', height: '36px', flexShrink: 0 }}
                onClick={onClear}
                title="Clear current questions & start fresh"
              >
                <RefreshCw size={14} />
              </button>
            )}
          </>
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
