import React, { useState, useEffect, useRef } from 'react';
import { getAppSettings } from '../data/apps';
import useResponsiveFontScale from '../hooks/useResponsiveFontScale';

const DateApp = ({ appId = 'date' }) => {
  const [date, setDate] = useState(new Date());
  const [settings, setSettings] = useState(getAppSettings(appId));
  const containerRef = useRef(null);
  const scale = useResponsiveFontScale(containerRef, {
    baseWidth: 240,
    baseHeight: 140,
    min: 0.7,
    max: 2.5
  });

  useEffect(() => {
    const timer = setInterval(() => {
      setDate(new Date());
    }, 60000); // Update every minute

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setSettings(getAppSettings(appId));
  }, [appId]);

  const formatDate = (dateInstance) => {
    const options = {
      weekday: 'long',
      month: settings.format === 'short' ? 'short' : 'long',
      day: 'numeric'
    };

    if (settings.showYear) {
      options.year = 'numeric';
    }

    return dateInstance.toLocaleDateString([], options);
  };

  const fontSize = Math.max(18, Math.min(48, 28 * scale));

  return (
    <div ref={containerRef} className="w-full h-full flex items-center justify-center p-4">
      <div
        className="text-center text-white font-light"
        style={{ fontSize: `${fontSize}px`, lineHeight: 1.25 }}
      >
        {formatDate(date)}
      </div>
    </div>
  );
};

export default DateApp;
