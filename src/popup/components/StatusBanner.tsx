import React from 'react';
import { AlertCircle, CheckCircle, Info, X } from 'lucide-react';

export interface BannerMessage {
  type: 'info' | 'success' | 'warning' | 'error';
  text: string;
}

interface StatusBannerProps {
  banner: BannerMessage | null;
  onDismiss: () => void;
}

export const StatusBanner: React.FC<StatusBannerProps> = ({ banner, onDismiss }) => {
  if (!banner) return null;

  const getIcon = () => {
    switch (banner.type) {
      case 'success':
        return <CheckCircle size={16} />;
      case 'error':
        return <AlertCircle size={16} />;
      case 'warning':
        return <AlertCircle size={16} />;
      default:
        return <Info size={16} />;
    }
  };

  return (
    <div className={`banner banner-${banner.type}`}>
      <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0, marginTop: '2px' }}>
        {getIcon()}
      </span>
      <span style={{ flex: 1, wordBreak: 'break-word' }}>{banner.text}</span>
      <button className="banner-close" onClick={onDismiss} title="Dismiss">
        <X size={14} />
      </button>
    </div>
  );
};
