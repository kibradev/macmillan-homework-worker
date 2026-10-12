import { Compass, Moon, Sun, Settings, Sparkles, PanelRight } from 'lucide-react';
import { PlatformDetectionResult } from '../../types/platform';

interface HeaderProps {
  activeTab: 'assistant' | 'settings';
  setActiveTab: (tab: 'assistant' | 'settings') => void;
  platform: PlatformDetectionResult | null;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  onOpenSidePanel?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  platform,
  theme,
  toggleTheme,
  onOpenSidePanel,
}) => {
  const isMacmillan = platform?.id === 'macmillan';

  return (
    <header className="app-header">
      <div className="header-top">
        <div className="logo-badge">
          <div className="logo-icon">
            <Compass size={16} />
          </div>
          <div>
            <div className="logo-title">
              StudyPilot <span className="logo-sub">MV3</span>
            </div>
          </div>
        </div>

        <div className="header-actions">
          {onOpenSidePanel && (
            <button
              className="icon-btn"
              onClick={onOpenSidePanel}
              title="Open in Chrome Side Panel (stays open permanently on screen)"
            >
              <PanelRight size={14} />
            </button>
          )}

          <button
            className="icon-btn"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div className={`platform-pill ${isMacmillan ? 'supported' : ''}`}>
          <span className="platform-indicator-dot" />
          <span>
            {platform
              ? platform.isPlatformPage
                ? platform.name
                : platform.hasExercise
                ? 'Generic Exercise Detected'
                : 'No Exercise Detected'
              : 'Scanning active tab...'}
          </span>
        </div>
      </div>

      <nav className="nav-tabs">
        <button
          className={`nav-tab ${activeTab === 'assistant' ? 'active' : ''}`}
          onClick={() => setActiveTab('assistant')}
        >
          <Sparkles size={13} />
          Assistant
        </button>
        <button
          className={`nav-tab ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          <Settings size={13} />
          AI & Settings
        </button>
      </nav>
    </header>
  );
};
