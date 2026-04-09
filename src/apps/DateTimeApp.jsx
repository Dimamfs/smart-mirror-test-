import { useState, useEffect, useRef } from 'react';
import useResponsiveFontScale from '../hooks/useResponsiveFontScale';
import { useLanguage } from '../contexts/LanguageContext';

// Soft cyan/blue glow — matches smart-mirror projected-text aesthetic
const GLOW = '0 0 8px rgba(120,220,255,0.55), 0 0 22px rgba(80,180,255,0.30)';
const GLOW_DIM = '0 0 6px rgba(120,220,255,0.25)';

const pad = (n) => String(n).padStart(2, '0');

const DateTimeApp = () => {
  const [now, setNow]       = useState(new Date());
  const containerRef        = useRef(null);
  const { t }               = useLanguage();

  const scale = useResponsiveFontScale(containerRef, {
    baseWidth:  260,
    baseHeight: 160,
    min: 0.55,
    max: 3.0
  });

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const s = (base) => Math.round(base * scale);

  const dateStr = `${t.weekdays[now.getDay()]}, ${t.months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;

  // Time parts
  let hours   = now.getHours();
  const mins  = pad(now.getMinutes());
  const secs  = pad(now.getSeconds());
  const isPM  = hours >= 12;
  const ampm  = isPM ? 'pm' : 'am';
  hours       = hours % 12 || 12;
  const hStr  = pad(hours);

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex flex-col justify-center"
      style={{ padding: `${s(12)}px ${s(20)}px`, gap: s(6) }}
    >
      {/* Date line */}
      <div
        className="font-light tracking-wide"
        style={{
          fontSize:   s(14),
          color:      'rgba(180, 230, 255, 0.70)',
          textShadow: GLOW_DIM,
          letterSpacing: '0.05em'
        }}
      >
        {dateStr}
      </div>

      {/* Time row */}
      <div
        className="flex items-baseline"
        style={{ gap: s(2), lineHeight: 1 }}
      >
        {/* HH:MM — dominant */}
        <span
          className="font-mono font-light"
          style={{
            fontSize:   s(62),
            color:      'rgba(210, 240, 255, 0.95)',
            textShadow: GLOW,
            letterSpacing: '-0.02em'
          }}
        >
          {hStr}:{mins}
        </span>

        {/* :SS — smaller */}
        <span
          className="font-mono font-light"
          style={{
            fontSize:   s(22),
            color:      'rgba(160, 215, 255, 0.65)',
            textShadow: GLOW_DIM,
            letterSpacing: '0.01em',
            marginBottom: s(2)
          }}
        >
          :{secs}
        </span>

        {/* am/pm */}
        <span
          className="font-light tracking-widest uppercase"
          style={{
            fontSize:   s(13),
            color:      'rgba(140, 200, 255, 0.50)',
            textShadow: GLOW_DIM,
            marginBottom: s(3),
            letterSpacing: '0.18em'
          }}
        >
          {ampm}
        </span>
      </div>

      {/* Subtle accent line */}
      <div
        style={{
          height:     1,
          width:      s(48),
          background: 'rgba(100, 200, 255, 0.20)',
          boxShadow:  '0 0 8px rgba(100,200,255,0.30)',
          marginTop:  s(2)
        }}
      />
    </div>
  );
};

export default DateTimeApp;
