import React, { useState, useRef, useEffect, useCallback } from 'react';

const STATUS_LABEL = {
  idle:       'Ready',
  connecting: 'Connecting…',
  listening:  'Listening…',
  thinking:   'Thinking…',
  speaking:   'Speaking…',
  error:      'Error',
};

const STATUS_COLOR = {
  idle:       'text-white/40',
  connecting: 'text-blue-300',
  listening:  'text-emerald-300',
  thinking:   'text-amber-300',
  speaking:   'text-purple-300',
  error:      'text-red-400',
};

export default function AIAssistantOverlay({ assistant }) {
  const {
    isOpen, status, statusMsg, errorMsg, volume,
    userText, aiText, history, speechOk, micError,
    cfg, endSession, sendText, clearHistory, unlockAudio,
  } = assistant;

  const [input, setInput] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const inputRef    = useRef(null);
  const historyRef  = useRef(null);

  // Auto-focus input when overlay opens
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 150);
  }, [isOpen]);

  // Scroll history to bottom when new messages arrive
  useEffect(() => {
    if (historyRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight;
    }
  }, [history, aiText, showHistory]);

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    if (!input.trim()) return;
    unlockAudio(); // user gesture — unlock audio before sending
    sendText(input);
    setInput('');
  }, [input, sendText, unlockAudio]);

  // Orb visuals driven by volume + status
  const orb = (() => {
    const v = Math.max(0, Math.min(volume, 1));
    const base = status === 'listening' ? 90 : status === 'speaking' ? 100 : 75;
    const size = base + v * 55;
    const alpha = status === 'speaking' ? 0.55 + v * 0.35 : 0.3 + v * 0.4;
    const glow  = 30 + v * 50;

    const color =
      status === 'listening' ? '52,211,153'  :  // emerald
      status === 'speaking'  ? '167,139,250' :  // purple
      status === 'thinking'  ? '251,191,36'  :  // amber
      status === 'connecting'? '96,165,250'  :  // blue
      status === 'error'     ? '248,113,113' :  // red
      '148,163,184';                             // slate (idle)

    return { size, alpha, glow, color };
  })();

  if (!isOpen) return null;

  const displayMsg = errorMsg || statusMsg || STATUS_LABEL[status] || '';
  const recentHistory = history.slice(-12);

  return (
    <div
      className="absolute inset-0 z-[999] flex flex-col items-center justify-center"
      style={{ backdropFilter: 'blur(16px)', background: 'rgba(0,0,0,0.35)' }}
    >
      {/* Animated orb */}
      <div
        className="mb-5 rounded-full flex-shrink-0 transition-all duration-150"
        style={{
          width:  orb.size,
          height: orb.size,
          background: `radial-gradient(circle at 40% 35%, rgba(${orb.color},${(orb.alpha + 0.15).toFixed(2)}) 0%, rgba(${orb.color},${orb.alpha.toFixed(2)}) 45%, transparent 75%)`,
          boxShadow: `0 0 ${orb.glow}px rgba(${orb.color},${(orb.alpha * 0.8).toFixed(2)}), 0 0 ${orb.glow * 2}px rgba(${orb.color},${(orb.alpha * 0.3).toFixed(2)})`,
        }}
      />

      {/* Name + status */}
      <p className="text-2xl font-semibold text-white tracking-wide mb-1">
        Hey {cfg?.name || 'Mirror'}
      </p>
      <p className={`text-sm mb-4 transition-colors duration-300 ${errorMsg ? 'text-red-400' : STATUS_COLOR[status] || 'text-white/50'}`}>
        {displayMsg}
      </p>

      {/* Live transcript bubbles */}
      {(userText || aiText) && (
        <div className="w-full max-w-lg px-5 mb-3 space-y-2">
          {userText && (
            <div className="flex justify-end">
              <span className="inline-block bg-white/12 text-white/90 text-sm px-4 py-2 rounded-2xl rounded-tr-sm max-w-xs leading-snug">
                {userText}
              </span>
            </div>
          )}
          {aiText && (
            <div className="flex justify-start">
              <span className="inline-block bg-white/8 border border-white/10 text-white/85 text-sm px-4 py-2 rounded-2xl rounded-tl-sm max-w-xs leading-snug">
                {aiText}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Conversation history toggle */}
      {recentHistory.length > 0 && (
        <div className="w-full max-w-lg px-5 mb-3">
          <button
            onClick={() => setShowHistory(v => !v)}
            className="text-xs text-white/35 hover:text-white/55 transition mb-2"
          >
            {showHistory ? '▲ Hide history' : `▼ Show history (${recentHistory.length} messages)`}
          </button>

          {showHistory && (
            <div
              ref={historyRef}
              className="max-h-48 overflow-y-auto space-y-2 pr-1"
              style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.15) transparent' }}
            >
              {recentHistory.map((h, i) => (
                <div key={i} className={`flex ${h.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <span className={`inline-block text-xs px-3 py-1.5 rounded-xl max-w-xs leading-snug ${
                    h.role === 'user'
                      ? 'bg-white/10 text-white/75'
                      : 'bg-white/6 border border-white/8 text-white/65'
                  }`}>
                    {h.content}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Text input */}
      <form onSubmit={handleSubmit} className="flex gap-2 w-full max-w-lg px-5">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Type a message…"
          className="flex-1 bg-white/10 border border-white/15 rounded-full px-4 py-2.5 text-sm text-white placeholder-white/35 outline-none focus:border-white/40 focus:bg-white/14 transition"
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className="bg-white/12 hover:bg-white/20 disabled:opacity-30 border border-white/15 rounded-full px-5 py-2.5 text-sm font-medium text-white transition-all"
        >
          Send
        </button>
      </form>

      {/* Warnings */}
      {!speechOk && (
        <p className="mt-3 text-xs text-amber-400/80 max-w-xs text-center">
          Speech recognition not supported in this browser. Use text input above.
        </p>
      )}
      {micError && (
        <p className="mt-2 text-xs text-red-400/80 max-w-xs text-center">{micError}</p>
      )}

      {/* Footer controls */}
      <div className="mt-4 flex items-center gap-4">
        <button
          onClick={endSession}
          className="text-xs text-white/30 hover:text-white/55 transition"
        >
          Say "Close" or dismiss ✕
        </button>
        {history.length > 0 && (
          <button
            onClick={() => { clearHistory(); setShowHistory(false); }}
            className="text-xs text-white/20 hover:text-red-400/60 transition"
          >
            Clear history
          </button>
        )}
      </div>

      {/* Model/voice badge */}
      <p className="mt-3 text-[10px] uppercase tracking-widest text-white/20">
        {cfg?.realtimeModel?.replace('gpt-4o-realtime-preview-', 'realtime ')} · voice: {cfg?.voice}
      </p>
    </div>
  );
}
