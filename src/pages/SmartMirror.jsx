import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import DraggableApp from '../components/DraggableApp';
import CursorOverlay from '../components/CursorOverlay';
import HandTrackingService from '../components/HandTrackingService';
import AIAssistantOverlay from '../components/AIAssistantOverlay';
import { apps, getAppSettings } from '../data/apps';
import { getGeneralSettings, getAccentOption, getFontOption } from '../data/generalSettings';
import { useAIAssistant } from '../hooks/useAIAssistant';

// Import all app components
import DateTimeApp from '../apps/DateTimeApp';
import WeatherApp from '../apps/WeatherApp';
import NewsApp from '../apps/NewsApp';
import SpotifyApp from '../apps/spotify/App';
import GmailApp from '../apps/gmail/GmailApp';

const hexToRgba = (hex, alpha) => {
  if (!hex) {
    return `rgba(255, 255, 255, ${alpha})`;
  }

  let normalized = hex.replace('#', '');
  if (normalized.length === 3) {
    normalized = normalized.split('').map(char => char + char).join('');
  }

  const bigint = parseInt(normalized, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const SmartMirror = () => {
  // ── AI assistant (new unified hook) ──────────────────────────────────────
  const assistant = useAIAssistant();

  // ── Mirror UI state ───────────────────────────────────────────────────────
  const [enabledApps, setEnabledApps] = useState([]);
  const [generalSettings, setGeneralSettings] = useState(() => getGeneralSettings());
  const containerRef = useRef(null);
  const [cursorPosition, setCursorPosition] = useState({ x: 0, y: 0, detected: false });
  const [handTrackingEnabled, setHandTrackingEnabled] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragTarget, setDragTarget] = useState(null);
  const dragTargetRef = useRef(null);
  const [appPositions, setAppPositions] = useState({});
  const [hoveredAppId, setHoveredAppId] = useState(null);
  const [activeWidgetId, setActiveWidgetId] = useState(null);
  const [sleepState, setSleepState] = useState('awake');
  const [wakeCircle, setWakeCircle] = useState(null);
  const sleepTimerRef = useRef(null);
  const sleepStateRef = useRef('awake');
  const wakeGestureStageRef = useRef('idle');
  const wakeAwaitTimerRef = useRef(null);
  const sleepWakeTimerRef = useRef(null);
  const sleepWakeLastPositionRef = useRef(null);
  const [sleepWakeCursorVisible, setSleepWakeCursorVisible] = useState(false);

  useEffect(() => {
    sleepStateRef.current = sleepState;
  }, [sleepState]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const accent = getAccentOption(generalSettings.accent);
    const font = getFontOption(generalSettings.font);
    const isNoAccent = generalSettings.accent === 'none';
    const accentSoft = hexToRgba(accent.glow || accent.color, isNoAccent ? 0 : 0.45);
    const accentGlow = hexToRgba(accent.color, isNoAccent ? 0 : 0.22);
    const accentHalo = hexToRgba(accent.color, isNoAccent ? 0 : 0.38);

    const root = document.documentElement;
    root.style.setProperty('--mirror-accent-color', isNoAccent ? 'rgba(255,255,255,0.18)' : accent.color);
    root.style.setProperty('--mirror-accent-soft', accentSoft);
    root.style.setProperty('--mirror-font-family', font.stack);
    root.style.setProperty(
      '--mirror-widget-border',
      generalSettings.widgetBorders ? '1px solid rgba(255, 255, 255, 0.18)' : '0px solid transparent'
    );
    root.style.setProperty(
      '--mirror-widget-shadow',
      generalSettings.widgetShadows ? `0 22px 45px ${accentGlow}, 0 0 30px ${accentHalo}` : 'none'
    );
    root.style.setProperty(
      '--mirror-widget-shadow-strong',
      generalSettings.widgetShadows ? `0 0 32px ${accentHalo}` : 'none'
    );
  }, [generalSettings]);



  const clearDragState = useCallback(() => {
    // Clear all app highlights first
    const allApps = document.querySelectorAll('[data-app-id]');
    allApps.forEach(app => {
      app.style.transition = '';
      app.style.boxShadow = '';
      app.style.transform = '';
      app.style.zIndex = '';
      app.style.pointerEvents = '';
    });

    setIsDragging(false);
    setDragTarget(null);
    dragTargetRef.current = null; // Clear ref immediately
    // Don't clear appPositions here as they need to persist for the final save
  }, []);

  const resetSleepTimer = useCallback(() => {
    if (sleepTimerRef.current) {
      clearTimeout(sleepTimerRef.current);
      sleepTimerRef.current = null;
    }

    if (!generalSettings.mirrorTimeoutEnabled) {
      return;
    }

    const minutes = Number(generalSettings.mirrorTimeoutMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return;
    }

    if (sleepStateRef.current !== 'awake') {
      return;
    }

    const delay = Math.max(1, Math.round(minutes)) * 60 * 1000;

    sleepTimerRef.current = setTimeout(() => {
      if (sleepStateRef.current !== 'awake') {
        return;
      }

      sleepTimerRef.current = null;
      sleepStateRef.current = 'sleeping';
      clearDragState();
      setHoveredAppId(null);
      setCursorPosition(prev => ({ ...prev, detected: false }));
      setSleepState('sleeping');
      setWakeCircle(null);
      wakeGestureStageRef.current = 'idle';
      setSleepWakeCursorVisible(false);
      sleepWakeLastPositionRef.current = null;
      if (sleepWakeTimerRef.current) {
        clearTimeout(sleepWakeTimerRef.current);
        sleepWakeTimerRef.current = null;
      }
      if (wakeAwaitTimerRef.current) {
        clearTimeout(wakeAwaitTimerRef.current);
        wakeAwaitTimerRef.current = null;
      }
    }, delay);
  }, [clearDragState, generalSettings.mirrorTimeoutEnabled, generalSettings.mirrorTimeoutMinutes]);

  const wakeMirror = useCallback((origin) => {
    if (sleepStateRef.current !== 'sleeping') {
      return;
    }

    if (sleepWakeTimerRef.current) {
      clearTimeout(sleepWakeTimerRef.current);
      sleepWakeTimerRef.current = null;
    }

    sleepWakeLastPositionRef.current = null;
    setSleepWakeCursorVisible(false);

    sleepStateRef.current = 'waking';
    setSleepState('waking');
    setWakeCircle(prev => (prev ? { ...prev, x: origin.x, y: origin.y } : { x: origin.x, y: origin.y, strength: 0 }));
    wakeGestureStageRef.current = 'animating';

    if (wakeAwaitTimerRef.current) {
      clearTimeout(wakeAwaitTimerRef.current);
      wakeAwaitTimerRef.current = null;
    }

    const appElements = document.querySelectorAll('[data-app-id]');
    appElements.forEach(element => {
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const translateX = origin.x - centerX;
      const translateY = origin.y - centerY;

      element.animate(
        [
          { transform: `translate(${translateX}px, ${translateY}px) scale(0.7)`, opacity: 0 },
          { transform: 'translate(0px, 0px) scale(1)', opacity: 1 }
        ],
        {
          duration: 420,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
        }
      );
    });

    setTimeout(() => {
      wakeGestureStageRef.current = 'idle';
      setWakeCircle(null);
      sleepStateRef.current = 'awake';
      setSleepState('awake');
      resetSleepTimer();
    }, 440);
  }, [resetSleepTimer]);

  useEffect(() => {
    if (!generalSettings.mirrorTimeoutEnabled) {
      if (sleepTimerRef.current) {
        clearTimeout(sleepTimerRef.current);
        sleepTimerRef.current = null;
      }
      if (wakeAwaitTimerRef.current) {
        clearTimeout(wakeAwaitTimerRef.current);
        wakeAwaitTimerRef.current = null;
      }
      if (sleepStateRef.current !== 'awake') {
        sleepStateRef.current = 'awake';
        setSleepState('awake');
      }
      setWakeCircle(null);
      wakeGestureStageRef.current = 'idle';
      return;
    }

    resetSleepTimer();
  }, [generalSettings.mirrorTimeoutEnabled, generalSettings.mirrorTimeoutMinutes, resetSleepTimer]);

  useEffect(() => {
    if (!generalSettings.mirrorTimeoutEnabled) {
      return undefined;
    }

    const handleActivity = () => {
      if (sleepStateRef.current === 'awake') {
        resetSleepTimer();
      }
    };

    const events = ['mousemove', 'keydown', 'pointerdown', 'touchstart'];
    events.forEach(event => window.addEventListener(event, handleActivity));

    return () => {
      events.forEach(event => window.removeEventListener(event, handleActivity));
    };
  }, [generalSettings.mirrorTimeoutEnabled, resetSleepTimer]);

  useEffect(() => () => {
    if (sleepTimerRef.current) {
      clearTimeout(sleepTimerRef.current);
    }
    if (wakeAwaitTimerRef.current) {
      clearTimeout(wakeAwaitTimerRef.current);
    }
    if (sleepWakeTimerRef.current) {
      clearTimeout(sleepWakeTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (sleepState === 'awake') {
      setSleepWakeCursorVisible(false);
      sleepWakeLastPositionRef.current = null;
      if (sleepWakeTimerRef.current) {
        clearTimeout(sleepWakeTimerRef.current);
        sleepWakeTimerRef.current = null;
      }
    }
  }, [sleepState]);

  useEffect(() => {
    // Get enabled apps that are not background services
    const getVisibleApps = () => {
      const settings = JSON.parse(localStorage.getItem('smartMirrorSettings') || '{}');
      return apps.filter(app =>
        !app.isBackgroundService && // Filter out background services
        settings[app.id]?.enabled !== false
      );
    };

    setEnabledApps(getVisibleApps());

    // Check if hand tracking is enabled
    const handTrackingSettings = getAppSettings('handtracking');

    // TEMPORARY: Force enable hand tracking for debugging
    const forceEnabled = true; // Set this to false when done debugging
    setHandTrackingEnabled(forceEnabled || handTrackingSettings.enabled || false);
    setGeneralSettings(getGeneralSettings());

    // Listen for settings changes
    const handleStorageChange = () => {
      setEnabledApps(getVisibleApps());
      const updatedHandTrackingSettings = getAppSettings('handtracking');
      setHandTrackingEnabled(updatedHandTrackingSettings.enabled || false);
      setGeneralSettings(getGeneralSettings());
    };

    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearDragState();
    };
  }, [clearDragState]);

  const handleHandPosition = (position) => {
    setCursorPosition(position);

    if (sleepState !== 'awake') {
      if (sleepState === 'sleeping') {
        if (!position.detected) {
          setSleepWakeCursorVisible(false);
          sleepWakeLastPositionRef.current = null;
          if (sleepWakeTimerRef.current) {
            clearTimeout(sleepWakeTimerRef.current);
            sleepWakeTimerRef.current = null;
          }
          if (wakeAwaitTimerRef.current) {
            clearTimeout(wakeAwaitTimerRef.current);
            wakeAwaitTimerRef.current = null;
          }
          wakeGestureStageRef.current = 'idle';
          setWakeCircle(null);
          return;
        }

        const sanitizedPosition = {
          x: Number.isFinite(position.x) ? position.x : window.innerWidth / 2,
          y: Number.isFinite(position.y) ? position.y : window.innerHeight / 2
        };

        sleepWakeLastPositionRef.current = sanitizedPosition;
        setSleepWakeCursorVisible(true);

        if (!sleepWakeTimerRef.current) {
          wakeGestureStageRef.current = 'awaiting';
          sleepWakeTimerRef.current = setTimeout(() => {
            sleepWakeTimerRef.current = null;

            if (sleepStateRef.current !== 'sleeping') {
              setSleepWakeCursorVisible(false);
              sleepWakeLastPositionRef.current = null;
              wakeGestureStageRef.current = 'idle';
              return;
            }

            const finalPosition = sleepWakeLastPositionRef.current;
            const origin = {
              x: Number.isFinite(finalPosition?.x) ? finalPosition.x : window.innerWidth / 2,
              y: Number.isFinite(finalPosition?.y) ? finalPosition.y : window.innerHeight / 2
            };

            wakeMirror(origin);
          }, 3000);
        }
      }

      return;
    }

    if (generalSettings.mirrorTimeoutEnabled && position.detected) {
      resetSleepTimer();
    }

    if (!generalSettings.widgetHoverHighlight || !handTrackingEnabled) {
      if (hoveredAppId !== null) {
        setHoveredAppId(null);
      }
    } else if (position.detected) {
      const allApps = document.querySelectorAll('[data-app-id]');
      let targetAppId = null;
      let highestZIndex = -Infinity;

      allApps.forEach(app => {
        const rect = app.getBoundingClientRect();
        const isUnderCursor = position.x >= rect.left &&
          position.x <= rect.right &&
          position.y >= rect.top &&
          position.y <= rect.bottom;

        if (isUnderCursor) {
          const zIndex = parseInt(window.getComputedStyle(app).zIndex) || 0;
          if (zIndex >= highestZIndex) {
            highestZIndex = zIndex;
            targetAppId = app.dataset.appId;
          }
        }
      });

      if (targetAppId !== hoveredAppId) {
        setHoveredAppId(targetAppId);
      }
    } else if (hoveredAppId !== null) {
      setHoveredAppId(null);
    }

    // Always clear highlights when not pinching or hand not detected
    if ((!position.isPinching || !position.detected) && !isDragging) {
      clearDragState();
    }

    // Handle pinch-to-drag functionality
    if (position.detected && position.isPinching) {
      if (!dragTargetRef.current) {
        // Start dragging - find all apps and check which one is under cursor
        const allApps = document.querySelectorAll('[data-app-id]');
        let targetApp = null;
        let highestZIndex = -1;

        allApps.forEach(app => {
          const rect = app.getBoundingClientRect();
          const isUnderCursor = position.x >= rect.left &&
                               position.x <= rect.right &&
                               position.y >= rect.top &&
                               position.y <= rect.bottom;

          if (isUnderCursor) {
            const zIndex = parseInt(window.getComputedStyle(app).zIndex) || 0;
            if (zIndex >= highestZIndex) {
              highestZIndex = zIndex;
              targetApp = app;
            }
          }
        });

        if (targetApp) {
          // Clear any existing highlights
          clearDragState();

          setIsDragging(true);
          const rect = targetApp.getBoundingClientRect();
          const containerRect = containerRef.current?.getBoundingClientRect();

          const dragTargetData = {
            appId: targetApp.dataset.appId,
            element: targetApp,
            startX: position.x,
            startY: position.y,
            offsetX: position.x - rect.left,
            offsetY: position.y - rect.top,
            initialPosition: {
              x: containerRect ? rect.left - containerRect.left : rect.left,
              y: containerRect ? rect.top - containerRect.top : rect.top
            }
          };

          setDragTarget(dragTargetData);
          dragTargetRef.current = dragTargetData; // Set ref immediately

          // Add visual feedback with lower z-index than cursor
          targetApp.style.transition = 'none';
          targetApp.style.boxShadow = '0 0 20px rgba(59, 130, 246, 0.8)';
          targetApp.style.transform = 'none'; // NO TRANSFORM DURING DRAG - interferes with positioning
          targetApp.style.zIndex = '1000'; // Still below cursor at 9999

          // Force immediate position update to prevent lag
          targetApp.style.pointerEvents = 'none';
        }
      } else {
        const currentDragTarget = dragTargetRef.current;
        // Continue dragging - calculate new position using React state
        const containerRect = containerRef.current?.getBoundingClientRect();
        const appWidth = currentDragTarget.element?.offsetWidth || 300;
        const appHeight = currentDragTarget.element?.offsetHeight || 200;
        const containerWidth = containerRect?.width || window.innerWidth;
        const containerHeight = containerRect?.height || window.innerHeight;

        // Calculate new position relative to the initial drag start
        const deltaX = position.x - currentDragTarget.startX;
        const deltaY = position.y - currentDragTarget.startY;

        const newLeft = Math.max(0, Math.min(containerWidth - appWidth, currentDragTarget.initialPosition.x + deltaX));
        const newTop = Math.max(0, Math.min(containerHeight - appHeight, currentDragTarget.initialPosition.y + deltaY));

        // Update position in React state and force immediate DOM update
        const newPosition = { x: newLeft, y: newTop };

        setAppPositions(prev => ({
          ...prev,
          [currentDragTarget.appId]: newPosition
        }));

        // Force immediate visual update to the DOM element for smoother dragging
        if (currentDragTarget.element) {
          currentDragTarget.element.style.left = `${newLeft}px`;
          currentDragTarget.element.style.top = `${newTop}px`;
        }
      }
    } else if (isDragging && dragTarget) {
      // Stop dragging

      // Get final position from state
      const finalPosition = appPositions[dragTarget.appId] || dragTarget.initialPosition;

      // Save final position using the same key as DraggableApp
      const layout = {
        position: { x: finalPosition.x, y: finalPosition.y },
        size: {
          width: dragTarget.element?.offsetWidth || 300,
          height: dragTarget.element?.offsetHeight || 200
        }
      };
      localStorage.setItem(`smartMirror_${dragTarget.appId}_layout`, JSON.stringify(layout));

      // Clean up and reset state
      clearDragState();
    }
  };

  useEffect(() => {
    if (!generalSettings.widgetHoverHighlight || !handTrackingEnabled) {
      setHoveredAppId(null);
    }
  }, [generalSettings.widgetHoverHighlight, handTrackingEnabled]);

  // Component mapping
  const componentMap = {
    DateTimeApp,
    WeatherApp,
    NewsApp,
    SpotifyApp,
    GmailApp
  };

  const renderApp = (app) => {
    const AppComponent = componentMap[app.componentPath];

    if (!AppComponent) {
      console.error(`Component not found: ${app.componentPath}`);
      return null;
    }

    const isBeingDragged = isDragging && dragTarget?.appId === app.id;
    const externalPosition = appPositions[app.id];

    return (
      <DraggableApp
        key={app.id}
        appId={app.id}
        initialPosition={app.defaultPosition}
        initialSize={app.defaultSize}
        externalPosition={externalPosition}
        isExternallyDragged={isBeingDragged}
        hoverHighlightEnabled={generalSettings.widgetHoverHighlight}
        isHoverHighlighted={generalSettings.widgetHoverHighlight && hoveredAppId === app.id}
        widgetShadowsEnabled={generalSettings.widgetShadows}
        isActive={activeWidgetId === app.id}
        onActivate={() => setActiveWidgetId(app.id)}
      >
        <AppComponent appId={app.id} />
      </DraggableApp>
    );
  };

  const wakeCircleComputed = useMemo(() => {
    if (!wakeCircle) {
      return null;
    }

    const strength = Math.max(0, Math.min(wakeCircle.strength ?? 0, 1));
    const size = 140 + strength * 80;
    const glowOpacity = 0.35 + strength * 0.45;
    const ringDuration = Math.max(0.85, 1.5 - strength * 0.6);

    return {
      strength,
      size,
      glowOpacity,
      ringDuration
    };
  }, [wakeCircle]);

  return (
    <div ref={containerRef} className="w-screen h-screen bg-black overflow-hidden relative" onClick={() => setActiveWidgetId(null)}>
      <div
        className="absolute inset-0 z-[1100] bg-black transition-opacity duration-500"
        style={{
          opacity: sleepState === 'sleeping' ? 1 : 0,
          pointerEvents: sleepState === 'awake' ? 'none' : 'auto'
        }}
      />
      {wakeCircle && wakeCircleComputed && (
        <div
          className="wake-circle-wrapper z-[1200]"
          style={{
            left: `${wakeCircle.x}px`,
            top: `${wakeCircle.y}px`,
            width: `${wakeCircleComputed.size}px`,
            height: `${wakeCircleComputed.size}px`,
            opacity: sleepState === 'awake' ? 0 : 1
          }}
        >
          <div
            className="wake-circle-core"
            style={{
              boxShadow: `0 0 ${70 + wakeCircleComputed.strength * 90}px rgba(59, 130, 246, ${wakeCircleComputed.glowOpacity})`
            }}
          />
          <div
            className="wake-circle-ring"
            style={{
              animationDuration: `${wakeCircleComputed.ringDuration}s`
            }}
          />
          <div
            className="wake-circle-ring wake-circle-ring--delayed"
            style={{
              animationDuration: `${wakeCircleComputed.ringDuration + 0.25}s`
            }}
          />
        </div>
      )}
      {/* AI Assistant overlay — handles its own visibility */}
      <AIAssistantOverlay assistant={assistant} />

      {/* Hidden audio element for WebRTC playback */}
      <audio ref={assistant.remoteAudioRef} autoPlay playsInline className="hidden" />

      {/* Audio unlock banner */}
      {!assistant.audioUnlocked && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full text-xs text-white/60 bg-black/50 border border-white/10 backdrop-blur-sm select-none pointer-events-none">
          Tap anywhere to enable voice
        </div>
      )}

      {/* Open AI button */}
      <button
        onClick={() => {
          assistant.unlockAudio();
          assistant.isOpen ? assistant.endSession() : assistant.open();
        }}
        className="fixed bottom-6 left-6 z-[1000] rounded-full px-4 py-2 text-xs font-semibold text-white/60 border border-white/10 bg-black/40 hover:bg-black/60 backdrop-blur-xl transition"
      >
        {assistant.isOpen ? 'Close AI' : 'Open AI'}
      </button>

      {/* Settings Button */}
      <Link
        to="/settings"
        className="fixed bottom-6 right-6 z-[1000] rounded-full p-3 transition-all duration-300 border border-white/10 bg-black/40 hover:bg-black/60 backdrop-blur-xl"
        style={{
          color: 'var(--mirror-accent-color)',
          boxShadow: generalSettings.widgetShadows ? '0 12px 30px var(--mirror-accent-soft)' : 'none'
        }}
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </Link>

      {/* Background Hand Tracking Service */}
      <HandTrackingService
        onHandPosition={handleHandPosition}
        settings={getAppSettings('handtracking')}
        enabled={handTrackingEnabled}
      />

      {/* Render enabled apps */}
      {enabledApps.map(renderApp)}

      {/* Hand tracking cursor overlay */}
      <CursorOverlay
        position={cursorPosition}
        isVisible={
          handTrackingEnabled &&
          cursorPosition.detected &&
          (sleepState === 'awake' || (sleepState === 'sleeping' && sleepWakeCursorVisible))
        }
        isDragging={isDragging}
        variant={sleepState === 'sleeping' ? 'sleep' : 'default'}
      />

      {/* Instructions overlay (only show if no apps are enabled) */}
      {enabledApps.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center text-white/70">
            <div className="text-6xl mb-4">🪟</div>
            <div className="text-2xl mb-2">Smart Mirror</div>
            <div className="text-lg mb-4">No apps enabled</div>
            <Link 
              to="/settings"
              className="bg-white/20 hover:bg-white/30 px-6 py-3 rounded-lg transition-colors"
            >
              Go to Settings
            </Link>
          </div>
        </div>
      )}
    </div>
  );
};

export default SmartMirror;
