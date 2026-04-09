import React, { useState, useEffect, useRef } from 'react';
import { getAppSettings } from '../data/apps';
import useResponsiveFontScale from '../hooks/useResponsiveFontScale';

const baseFontSizeMap = {
  small: 48,
  medium: 72,
  large: 96
};

const ClockApp = ({ appId = 'clock' }) => {
  const [time, setTime] = useState(new Date());
  const [settings, setSettings] = useState(getAppSettings(appId));
  const containerRef = useRef(null);
  const scale = useResponsiveFontScale(containerRef, {
    baseWidth: 260,
    baseHeight: 180,
    min: 0.5,
    max: 4
  });

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setSettings(getAppSettings(appId));
  }, [appId]);

  const formatTimeParts = (date) => {
    const options = {
      hour: '2-digit',
      minute: '2-digit',
      hour12: !settings.format24h
    };

    if (settings.showSeconds) {
      options.second = '2-digit';
    }

    const timeString = date.toLocaleTimeString([], options);

    if (settings.format24h) {
      return { main: timeString, period: '' };
    }

    const parts = timeString.split(' ');
    const period = parts.pop() || '';
    const main = parts.join(' ');

    return { main, period };
  };

  const getFontSize = () => {
    const base = baseFontSizeMap[settings.fontSize] || baseFontSizeMap.medium;
    return Math.max(28, base * scale);
  };

  const { main, period } = formatTimeParts(time);
  const mainFontSize = getFontSize();
  const periodFontSize = Math.max(16, mainFontSize * 0.35);

  return (
    <div ref={containerRef} className="w-full h-full flex items-center justify-center p-4">
      <div className="text-center" style={{ lineHeight: 1 }}>
        <div
          className="font-mono font-semibold text-white"
          style={{ fontSize: `${mainFontSize}px` }}
        >
          {main}
        </div>
        {!settings.format24h && period && (
          <div
            className="text-white/70 mt-2 tracking-[0.35em] uppercase"
            style={{ fontSize: `${periodFontSize}px` }}
          >
            {period}
          </div>
        )}
        <div
          className="mt-4 h-1 w-16 mx-auto rounded-full opacity-80"
          style={{ background: 'var(--mirror-accent-color)' }}
        />
      </div>
    </div>
  );
};

export default ClockApp;
