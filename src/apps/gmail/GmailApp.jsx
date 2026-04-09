import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getAppSettings } from '../../data/apps';
import useResponsiveFontScale from '../../hooks/useResponsiveFontScale';
import { fetchGmailStatus, fetchGmailMessages } from './gmailService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatTimeAgo(timestamp) {
  const diffMs = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function StatusBadge({ connected, email, scale }) {
  const dotSize = Math.max(6, 7 * scale);
  const textSize = Math.max(10, 11 * scale);
  return (
    <div className="flex items-center gap-1.5" style={{ fontSize: `${textSize}px` }}>
      <span
        style={{
          width: dotSize,
          height: dotSize,
          borderRadius: '50%',
          display: 'inline-block',
          flexShrink: 0,
          backgroundColor: connected ? '#34d399' : '#f87171',
        }}
      />
      <span className="text-white/60 truncate" style={{ maxWidth: '14em' }}>
        {connected ? email : 'Not connected'}
      </span>
    </div>
  );
}

function UnreadBadge({ count, scale }) {
  if (!count) return null;
  const size = Math.max(14, 16 * scale);
  return (
    <span
      className="rounded-full flex items-center justify-center font-semibold"
      style={{
        fontSize: `${Math.max(9, 10 * scale)}px`,
        minWidth: size,
        height: size,
        padding: '0 4px',
        backgroundColor: 'var(--mirror-accent-color, #60a5fa)',
        color: '#000',
        lineHeight: 1,
      }}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

function MessageRow({ msg, showSnippet, scale }) {
  const senderSize = Math.max(12, 13 * scale);
  const subjectSize = Math.max(11, 12 * scale);
  const metaSize = Math.max(9, 10 * scale);

  return (
    <div
      className="py-2 border-b border-white/10 last:border-b-0"
      style={{ opacity: msg.unread ? 1 : 0.65 }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {msg.unread && (
            <span
              style={{
                width: Math.max(5, 6 * scale),
                height: Math.max(5, 6 * scale),
                borderRadius: '50%',
                display: 'inline-block',
                flexShrink: 0,
                backgroundColor: 'var(--mirror-accent-color, #60a5fa)',
              }}
            />
          )}
          <span
            className="text-white truncate"
            style={{
              fontSize: `${senderSize}px`,
              fontWeight: msg.unread ? 600 : 400,
            }}
          >
            {msg.from}
          </span>
        </div>
        <span className="text-white/40 shrink-0" style={{ fontSize: `${metaSize}px` }}>
          {formatTimeAgo(msg.timestamp)}
        </span>
      </div>

      <div
        className="text-white/80 truncate mt-0.5"
        style={{ fontSize: `${subjectSize}px` }}
      >
        {msg.subject}
      </div>

      {showSnippet && msg.snippet && (
        <div
          className="text-white/45 truncate mt-0.5"
          style={{ fontSize: `${metaSize}px` }}
        >
          {msg.snippet}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main widget
// ---------------------------------------------------------------------------
const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 min

const GmailApp = ({ appId = 'gmail' }) => {
  const containerRef = useRef(null);
  const scale = useResponsiveFontScale(containerRef, {
    baseWidth: 340,
    baseHeight: 300,
    min: 0.75,
    max: 2,
  });

  const [settings, setSettings] = useState(() => getAppSettings(appId));

  const [status, setStatus] = useState(null);       // GmailStatus | null
  const [mailData, setMailData] = useState(null);   // GmailMessagesResponse | null
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Re-read settings when localStorage changes (settings page saves)
  useEffect(() => {
    const onStorage = () => setSettings(getAppSettings(appId));
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [appId]);

  const load = useCallback(async () => {
    setError('');

    // Multi-user hook: swap null for the active profile ID when available,
    // e.g.:  const profileId = getActiveProfileId();
    const profileId = null;

    try {
      const [gmailStatus, gmailMessages] = await Promise.all([
        fetchGmailStatus({ profileId }),
        fetchGmailMessages({
          limit: settings.maxEmails ?? 5,
          profileId,
        }),
      ]);
      setStatus(gmailStatus);
      setMailData(gmailMessages);
    } catch (err) {
      console.error('Gmail widget error:', err);
      setError(err.message || 'Unable to load Gmail data');
    } finally {
      setLoading(false);
    }
  }, [settings.maxEmails]);

  // Initial load + polling
  useEffect(() => {
    setLoading(true);
    load();
    const interval = setInterval(load, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  // ---------------------------------------------------------------------------
  // Derived sizing
  // ---------------------------------------------------------------------------
  const headerSize   = Math.max(16, 18 * scale);
  const subjectSize  = Math.max(12, 13 * scale);
  const metaSize     = Math.max(10, 11 * scale);

  // ---------------------------------------------------------------------------
  // Render states
  // ---------------------------------------------------------------------------
  const isNotConnected = status && !status.connected;

  let content;

  if (loading && !mailData) {
    content = (
      <div
        className="flex-1 flex items-center justify-center text-white/50"
        style={{ fontSize: `${subjectSize}px` }}
      >
        Loading...
      </div>
    );
  } else if (error && !mailData) {
    content = (
      <div className="flex-1 flex flex-col items-center justify-center text-center space-y-2">
        <div style={{ fontSize: `${headerSize * 1.4}px` }}>✉️</div>
        <div className="text-red-400" style={{ fontSize: `${subjectSize}px` }}>
          {error}
        </div>
        <button
          onClick={load}
          className="mt-1 text-white/50 underline"
          style={{ fontSize: `${metaSize}px` }}
        >
          Retry
        </button>
      </div>
    );
  } else if (isNotConnected) {
    content = (
      <div className="flex-1 flex flex-col items-center justify-center text-center space-y-2">
        <div style={{ fontSize: `${headerSize * 1.4}px` }}>✉️</div>
        <div className="text-white/60" style={{ fontSize: `${subjectSize}px` }}>
          Gmail not connected
        </div>
        <div className="text-white/35" style={{ fontSize: `${metaSize}px` }}>
          Connect your account in Settings
        </div>
      </div>
    );
  } else if (!mailData?.messages?.length) {
    content = (
      <div
        className="flex-1 flex items-center justify-center text-white/50"
        style={{ fontSize: `${subjectSize}px` }}
      >
        No emails available
      </div>
    );
  } else {
    content = (
      <div className="flex-1 overflow-auto pr-0.5">
        {mailData.messages.map((msg) => (
          <MessageRow
            key={msg.id}
            msg={msg}
            showSnippet={settings.showSnippets !== false}
            scale={scale}
          />
        ))}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full h-full flex flex-col p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-2 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-white font-semibold" style={{ fontSize: `${headerSize}px` }}>
            ✉️ Gmail
          </span>
          {loading && mailData && (
            <span className="text-white/40" style={{ fontSize: `${Math.max(10, 11 * scale)}px` }}>
              Updating…
            </span>
          )}
        </div>
        {settings.showUnreadCount !== false && mailData && (
          <UnreadBadge count={mailData.unreadCount} scale={scale} />
        )}
      </div>

      {/* Account status */}
      {status && (
        <div className="mb-2 shrink-0">
          <StatusBadge connected={status.connected} email={status.email} scale={scale} />
        </div>
      )}

      {content}
    </div>
  );
};

export default GmailApp;
