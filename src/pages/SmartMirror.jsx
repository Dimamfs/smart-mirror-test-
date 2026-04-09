import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import DraggableApp from '../components/DraggableApp';
import CursorOverlay from '../components/CursorOverlay';
import HandTrackingService from '../components/HandTrackingService';
import { apps, getAppSettings } from '../data/apps';
import { getAiAssistantSettings } from '../data/aiAssistant';
import { getGeneralSettings, getAccentOption, getFontOption } from '../data/generalSettings';

// Import all app components
import DateTimeApp from '../apps/DateTimeApp';
import WeatherApp from '../apps/WeatherApp';
import NewsApp from '../apps/NewsApp';
import SpotifyApp from '../apps/spotify/App';
import GmailApp from '../apps/gmail/GmailApp';

// ── Voice assistant helpers ────────────────────────────────────────────────

/**
 * Returns true if the transcript contains one of the configured wake phrases.
 * @param {string}   transcript     Normalised (lowercase, trimmed) transcript.
 * @param {string[]} hotwordPhrases Array of wake phrases to match against.
 */
function isWakeWord(transcript, hotwordPhrases) {
  return hotwordPhrases.some(phrase => transcript.includes(phrase));
}

/**
 * Returns true if the user wants to close / end the session.
 * Covers: "thank you", "thanks", "close", "stop", "goodbye", "bye".
 * @param {string} transcript Normalised transcript.
 */
function isCloseCommand(transcript) {
  const closeTerms = ['thank you', 'thanks', 'close', 'stop', 'goodbye', 'bye'];
  return closeTerms.some(term => transcript.includes(term));
}

/**
 * Returns true when the transcript looks like a real command (not random noise).
 * Rules:
 *  – Not empty / whitespace-only.
 *  – At least 2 words (single-word bursts are almost always false positives).
 * @param {string} transcript Normalised transcript.
 */
function isValidCommand(transcript) {
  if (!transcript || transcript.trim().length === 0) return false;
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  return words.length >= 2;
}

// ──────────────────────────────────────────────────────────────────────────────

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
  const [enabledApps, setEnabledApps] = useState([]);
  const [generalSettings, setGeneralSettings] = useState(() => getGeneralSettings());
  const containerRef = useRef(null);
  const [cursorPosition, setCursorPosition] = useState({ x: 0, y: 0, detected: false });
  const [handTrackingEnabled, setHandTrackingEnabled] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragTarget, setDragTarget] = useState(null);
  const dragTargetRef = useRef(null); // Immediate reference for drag logic
  const [appPositions, setAppPositions] = useState({}); // Track positions for each app
  const [hoveredAppId, setHoveredAppId] = useState(null);
  const [activeWidgetId, setActiveWidgetId] = useState(null);
  const recognitionRef = useRef(null);
  const audioContextRef = useRef(null);
  const assistantAudioContextRef = useRef(null);
  const assistantAnalyserRef = useRef(null);
  const assistantSourceRef = useRef(null);
  const assistantAnalyserDataRef = useRef(null);
  const assistantVolumeRafRef = useRef(null);
  const hideHotwordTimerRef = useRef(null);
  const [hotwordActive, setHotwordActive] = useState(false);
  const [aiAssistantSettings, setAiAssistantSettings] = useState(() => getAiAssistantSettings() || { enabled: false, settings: {} });
  const [hotwordDetected, setHotwordDetected] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  });
  const [micPermissionError, setMicPermissionError] = useState('');
  const [rawSpeechLog, setRawSpeechLog] = useState([]);
  const hotwordDetectedTimerRef = useRef(null);
  const dataChannelRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteAudioElementRef = useRef(null);
  const sessionStatusRef = useRef('idle');
  const sessionEndDelayTimerRef = useRef(null);
  const connectionRecoveryTimerRef = useRef(null);
  const [sessionStatus, setSessionStatus] = useState('idle');
  const [sessionError, setSessionError] = useState(null);
  const [sessionMessage, setSessionMessage] = useState('');
  const [assistantVolume, setAssistantVolume] = useState(0);
  const [sleepState, setSleepState] = useState('awake');
  const [wakeCircle, setWakeCircle] = useState(null);
  const sleepTimerRef = useRef(null);
  const sleepStateRef = useRef('awake');
  const wakeGestureStageRef = useRef('idle');
  const wakeAwaitTimerRef = useRef(null);
  const sleepWakeTimerRef = useRef(null);
  const sleepWakeLastPositionRef = useRef(null);
  // Voice assistant state machine refs
  const inactivityTimerRef = useRef(null);  // Auto-close after 15s of silence
  const cooldownTimerRef = useRef(null);    // Cooldown before re-listening for wake word
  const cooldownActiveRef = useRef(false);  // True during the cooldown window
  const audioUnlockedRef = useRef(false);   // True once browser autoplay is unlocked
  const localSessionActiveRef = useRef(false); // True after wake word; tracks commands independently of WebRTC
  const localSessionTimerRef = useRef(null);   // Inactivity timer for the local Chat+TTS session (30s)
  const [sleepWakeCursorVisible, setSleepWakeCursorVisible] = useState(false);

  const assistantSettings = useMemo(() => ({
    apiKey: aiAssistantSettings.settings?.apiKey?.trim() || '',
    model: aiAssistantSettings.settings?.model || 'gpt-4o-mini-realtime-preview',
    voice: aiAssistantSettings.settings?.voice || 'alloy',
    name: aiAssistantSettings.settings?.name || 'Mirror',
    showRawTranscripts: Boolean(aiAssistantSettings.settings?.showRawTranscripts)
  }), [aiAssistantSettings]);

  // ── Chat API + Web Speech TTS fallback pipeline ────────────────────────────
  // Used when the Realtime/WebRTC session fails or is unavailable.
  // speak() uses the browser's built-in speechSynthesis — no extra endpoint needed.

  const speak = useCallback((text) => {
    console.log('[TTS] Starting TTS...');
    if (!window.speechSynthesis) {
      console.warn('[TTS] speechSynthesis not supported in this browser');
      return;
    }

    const doSpeak = () => {
      window.speechSynthesis.cancel(); // stop any previous utterance
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.onstart = () => console.log('[TTS] Playing audio...');
      utterance.onerror = (e) => console.error('[TTS] Speech synthesis error:', e.error);
      // Chrome bug: speak() can silently fail if called while paused — resume first
      if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      window.speechSynthesis.speak(utterance);
    };

    // Chrome may not have voices loaded on first call — wait for them
    if (window.speechSynthesis.getVoices().length > 0) {
      doSpeak();
    } else {
      window.speechSynthesis.addEventListener('voiceschanged', doSpeak, { once: true });
    }
  }, []);

  const handleUserCommand = useCallback(async (transcript) => {
    if (!assistantSettings.apiKey) {
      console.warn('[AI] No API key — skipping Chat API call');
      return;
    }

    console.log('[AI] Transcript received:', transcript);
    console.log('[AI] Sending to AI...');
    setSessionMessage('Thinking\u2026');

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${assistantSettings.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `You are ${assistantSettings.name || 'Mirror'}, an AI assistant integrated into a smart mirror. Give brief, clear spoken responses of 1-2 sentences.`
            },
            { role: 'user', content: transcript }
          ],
          max_tokens: 150
        })
      });

      if (!res.ok) throw new Error(`OpenAI API returned ${res.status}`);

      const data = await res.json();
      const responseText = data.choices?.[0]?.message?.content?.trim() || '';

      console.log('[AI] AI response:', responseText);
      console.log('[TTS] Starting TTS...');

      setSessionMessage('Speaking\u2026');
      speak(responseText);
      setTimeout(() => setSessionMessage('Listening\u2026'), 200);
    } catch (err) {
      console.error('[AI] Error calling Chat API:', err);
      setSessionMessage('Error — try again');
      setTimeout(() => setSessionMessage('Listening\u2026'), 3000);
    }
  }, [assistantSettings.apiKey, assistantSettings.name, speak]);

  // ── End fallback pipeline ──────────────────────────────────────────────────

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

  // Unlock HTML audio autoplay on the first user interaction.
  // Browsers block programmatic audio.play() until a real user gesture has occurred.
  // Smart mirrors get no click/tap, so we register all interaction types and unlock once.
  useEffect(() => {
    const unlock = () => {
      if (audioUnlockedRef.current) return;
      const audio = remoteAudioElementRef.current;
      if (!audio) return;

      // Play a silent moment so the browser registers audio as user-gesture-unlocked
      audio.muted = true;
      const p = audio.play();
      if (p && p.then) {
        p.then(() => {
          audio.pause();
          audio.muted = false;
          audio.currentTime = 0;
          audioUnlockedRef.current = true;
          setAudioUnlocked(true);
          console.log('[Audio] Autoplay unlocked');
        }).catch(() => {
          audio.muted = false;
        });
      }
    };

    const events = ['click', 'touchstart', 'keydown', 'pointerdown'];
    events.forEach(e => document.addEventListener(e, unlock, { once: false, capture: true }));

    return () => {
      events.forEach(e => document.removeEventListener(e, unlock, { capture: true }));
    };
  }, []);

  const playHotwordDing = useCallback(async () => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return;
    }

    try {
      let audioContext = audioContextRef.current;
      if (!audioContext) {
        audioContext = new AudioContextClass();
        audioContextRef.current = audioContext;
      }

      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.type = 'sine';
      const now = audioContext.currentTime;
      oscillator.frequency.setValueAtTime(880, now);

      gainNode.gain.setValueAtTime(0.0001, now);
      gainNode.gain.exponentialRampToValueAtTime(0.3, now + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.start(now);
      oscillator.stop(now + 0.8);
    } catch (error) {
      console.error('Failed to play hotword sound', error);
    }
  }, []);

  const activateHotword = useCallback(() => {
    setHotwordActive(true);
    playHotwordDing();

    if (hideHotwordTimerRef.current) {
      clearTimeout(hideHotwordTimerRef.current);
      hideHotwordTimerRef.current = null;
    }
  }, [playHotwordDing]);

  const stopAssistantVolumeMonitor = useCallback(() => {
    if (assistantVolumeRafRef.current) {
      cancelAnimationFrame(assistantVolumeRafRef.current);
      assistantVolumeRafRef.current = null;
    }

    if (assistantAnalyserRef.current) {
      try {
        assistantAnalyserRef.current.disconnect();
      } catch (error) {
        console.error('Failed to disconnect assistant analyser', error);
      }
      assistantAnalyserRef.current = null;
    }

    if (assistantSourceRef.current) {
      try {
        assistantSourceRef.current.disconnect();
      } catch (error) {
        console.error('Failed to disconnect assistant audio source', error);
      }
      assistantSourceRef.current = null;
    }

    assistantAnalyserDataRef.current = null;

    if (assistantAudioContextRef.current) {
      try {
        assistantAudioContextRef.current.close();
      } catch (error) {
        console.error('Failed to close assistant audio context', error);
      }
      assistantAudioContextRef.current = null;
    }

    setAssistantVolume(0);
  }, []);

  const releaseRealtimeResources = useCallback(() => {
    if (connectionRecoveryTimerRef.current) {
      clearTimeout(connectionRecoveryTimerRef.current);
      connectionRecoveryTimerRef.current = null;
    }

    if (dataChannelRef.current) {
      try {
        dataChannelRef.current.close();
      } catch (error) {
        console.error('Failed to close realtime data channel', error);
      }
      dataChannelRef.current.onmessage = null;
      dataChannelRef.current.onopen = null;
      dataChannelRef.current = null;
    }

    if (peerConnectionRef.current) {
      try {
        peerConnectionRef.current.close();
      } catch (error) {
        console.error('Failed to close realtime peer connection', error);
      }
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.onconnectionstatechange = null;
      peerConnectionRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        try {
          track.stop();
        } catch (error) {
          console.error('Failed to stop local media track', error);
        }
      });
      localStreamRef.current = null;
    }

    if (remoteAudioElementRef.current) {
      try {
        remoteAudioElementRef.current.pause();
      } catch (error) {
        console.error('Failed to pause remote audio element', error);
      }
      remoteAudioElementRef.current.srcObject = null;
    }

    stopAssistantVolumeMonitor();
  }, [stopAssistantVolumeMonitor]);

  const setupAssistantVolumeMonitor = useCallback((stream) => {
    if (!stream) {
      return;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return;
    }

    stopAssistantVolumeMonitor();

    let audioContext = assistantAudioContextRef.current;
    try {
      if (!audioContext || audioContext.state === 'closed') {
        audioContext = new AudioContextClass();
        assistantAudioContextRef.current = audioContext;
      }

      if (audioContext.state === 'suspended') {
        audioContext.resume().catch(error => {
          console.error('Failed to resume assistant audio context', error);
        });
      }
    } catch (error) {
      console.error('Failed to initialise assistant audio context', error);
      return;
    }

    try {
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.6;

      source.connect(analyser);

      assistantSourceRef.current = source;
      assistantAnalyserRef.current = analyser;
      assistantAnalyserDataRef.current = new Uint8Array(analyser.frequencyBinCount);

      const updateVolume = () => {
        const analyserNode = assistantAnalyserRef.current;
        const dataArray = assistantAnalyserDataRef.current;

        if (!analyserNode || !dataArray) {
          return;
        }

        analyserNode.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i += 1) {
          sum += dataArray[i];
        }

        const average = dataArray.length ? sum / dataArray.length : 0;
        let normalized = Math.min(average / 128, 1);
        normalized = Math.pow(normalized, 0.6) * 1.4;
        if (normalized > 1) {
          normalized = 1;
        }

        setAssistantVolume(prev => prev * 0.65 + normalized * 0.35);

        assistantVolumeRafRef.current = requestAnimationFrame(updateVolume);
      };

      assistantVolumeRafRef.current = requestAnimationFrame(updateVolume);
    } catch (error) {
      console.error('Failed to setup assistant audio analyser', error);
      stopAssistantVolumeMonitor();
    }
  }, [stopAssistantVolumeMonitor]);

  const sendSessionConfiguration = useCallback(() => {
    if (!dataChannelRef.current) {
      console.warn('[Pipeline] sendSessionConfiguration: data channel not ready');
      return;
    }

    const assistantName = assistantSettings.name?.trim() || 'Mirror';
    const voice = assistantSettings.voice || 'alloy';
    const model = assistantSettings.model || 'gpt-4o-mini-realtime-preview';

    console.log(`[Pipeline] Step 3 — configuring session: voice=${voice} model=${model}`);

    const sessionUpdate = {
      type: 'session.update',
      session: {
        // REQUIRED: request both text and audio output — without this the AI
        // may only return text events and never send audio back over WebRTC.
        modalities: ['text', 'audio'],
        voice,
        instructions: `You are ${assistantName}, an AI assistant integrated with a smart mirror interface. Provide concise, spoken responses and assist with daily routines and smart home tasks when asked.`,
        // Server-side VAD: tells OpenAI when the user has stopped talking so it
        // knows when to generate and send its response automatically.
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 600
        },
        // Transcribe what the user says (shows in debug log)
        input_audio_transcription: {
          model: 'whisper-1'
        },
        tools: []
      }
    };

    try {
      dataChannelRef.current.send(JSON.stringify(sessionUpdate));
      console.log('[Pipeline] Step 3 — session.update sent OK');
    } catch (error) {
      console.error('[Pipeline] Step 3 — failed to send session.update:', error);
    }
  }, [assistantSettings]);

  const endRealtimeSession = useCallback(() => {
    console.log('[Assistant] endRealtimeSession called — state:', sessionStatusRef.current);
    console.log('[Local Session] Deactivated — resetting');
    localSessionActiveRef.current = false;
    if (localSessionTimerRef.current) {
      clearTimeout(localSessionTimerRef.current);
      localSessionTimerRef.current = null;
    }
    window.speechSynthesis?.cancel();

    if (sessionEndDelayTimerRef.current) {
      clearTimeout(sessionEndDelayTimerRef.current);
      sessionEndDelayTimerRef.current = null;
    }

    if (hideHotwordTimerRef.current) {
      clearTimeout(hideHotwordTimerRef.current);
      hideHotwordTimerRef.current = null;
    }

    // Clear inactivity timer
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }

    releaseRealtimeResources();

    setSessionMessage('Assistant closed');
    setSessionError(null);
    setSessionStatus('idle');
    sessionStatusRef.current = 'idle';
    setHotwordActive(false);

    // Cooldown: block wake word re-triggering for 2.5s to prevent noise re-activation
    if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    cooldownActiveRef.current = true;
    console.log('[Assistant] Cooldown started — 2.5s before wake word re-enabled');
    cooldownTimerRef.current = setTimeout(() => {
      cooldownActiveRef.current = false;
      cooldownTimerRef.current = null;
      setSessionMessage('');
      console.log('[Assistant] Cooldown ended — ready for "Hey Mirror"');
    }, 2500);
  }, [releaseRealtimeResources]);

  const startRealtimeSession = useCallback(async () => {
    if (sessionStatusRef.current === 'connecting' || sessionStatusRef.current === 'active') {
      return;
    }

    if (!aiAssistantSettings.enabled) {
      return;
    }

    if (!assistantSettings.apiKey) {
      setSessionStatus('error');
      sessionStatusRef.current = 'error';
      setSessionError('Add your OpenAI API key in Settings to talk to the assistant.');
      setSessionMessage('');
      activateHotword();

      if (hideHotwordTimerRef.current) {
        clearTimeout(hideHotwordTimerRef.current);
      }

      hideHotwordTimerRef.current = setTimeout(() => {
        setHotwordActive(false);
        setSessionStatus('idle');
        sessionStatusRef.current = 'idle';
        setSessionError(null);
      }, 5000);

      return;
    }

    try {
      activateHotword();
      setSessionStatus('connecting');
      sessionStatusRef.current = 'connecting';
      setSessionError(null);
      setSessionMessage('Connecting to your assistant...');

      if (!localStreamRef.current) {
        if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            'This browser cannot access a microphone (navigator.mediaDevices.getUserMedia is unavailable). Try updating your browser or enabling camera permissions.'
          );
        }

        localStreamRef.current = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            channelCount: 1
          }
        });

        // getUserMedia resolves inside a user-gesture activation context.
        // Unlock the remote audio element NOW so that audio.play() will
        // succeed when ontrack fires — without this, Chrome blocks playback
        // after a page reload because no click/tap has occurred yet.
        if (remoteAudioElementRef.current && !audioUnlockedRef.current) {
          const audio = remoteAudioElementRef.current;
          audio.muted = true;
          const unlockPromise = audio.play();
          if (unlockPromise && unlockPromise.then) {
            unlockPromise.then(() => {
              audio.pause();
              audio.muted = false;
              audio.currentTime = 0;
              audioUnlockedRef.current = true;
              setAudioUnlocked(true);
              console.log('[Audio] Unlocked via getUserMedia activation');
            }).catch(() => {
              audio.muted = false;
            });
          }
        }
      }

      const peerConnection = new RTCPeerConnection();
      peerConnectionRef.current = peerConnection;

      peerConnection.ontrack = (event) => {
        console.log(
          `[Pipeline] Step 5 — ontrack fired | streams: ${event.streams.length} | track kind: ${event.track?.kind} | track id: ${event.track?.id}`
        );

        // Some WebRTC peers (including OpenAI's) send the track with an empty
        // streams array. Fall back to creating a MediaStream from the track directly.
        let stream;
        if (event.streams && event.streams.length > 0) {
          stream = event.streams[0];
          console.log('[Pipeline] Step 5 — using event.streams[0]');
        } else if (event.track) {
          stream = new MediaStream([event.track]);
          console.log('[Pipeline] Step 5 — event.streams empty, created MediaStream from track');
        } else {
          console.error('[Pipeline] Step 5 — ontrack fired with no stream AND no track, cannot play audio');
          return;
        }

        if (!remoteAudioElementRef.current) {
          console.error('[Pipeline] Step 5 — audio element ref is null');
          return;
        }

        const audio = remoteAudioElementRef.current;
        audio.srcObject = stream;

        console.log('[Pipeline] Step 6 — srcObject assigned, calling play()');

        // Start muted so autoplay policy allows it, then immediately unmute.
        // This is the most reliable cross-browser workaround for smart-mirror/kiosk use.
        audio.muted = true;
        const tryPlay = (attempt) => {
          console.log(`[Pipeline] Step 6 — play() attempt ${attempt}`);
          const p = audio.play();
          if (p && p.then) {
            p.then(() => {
              audio.muted = false;   // unmute after play() resolves
              audioUnlockedRef.current = true;
              setAudioUnlocked(true);
              console.log('[Pipeline] Step 6 — playback started, audio unmuted');
            }).catch(err => {
              console.warn(`[Pipeline] Step 6 — play() attempt ${attempt} failed: ${err.name}: ${err.message}`);
              if (attempt < 6) {
                setTimeout(() => tryPlay(attempt + 1), 400);
              } else {
                // Last resort: play muted at least — user will hear nothing but connection stays live
                console.error('[Pipeline] Step 6 — all play() attempts failed. Try clicking the page first, or launch Chromium with --autoplay-policy=no-user-gesture-required for kiosk use.');
                audio.muted = false;
              }
            });
          } else {
            // Synchronous play (older browsers) — just unmute
            audio.muted = false;
            console.log('[Pipeline] Step 6 — synchronous play() called');
          }
        };

        tryPlay(1);
        setupAssistantVolumeMonitor(stream);
      };

      peerConnection.onconnectionstatechange = () => {
        const state = peerConnection.connectionState;
        if (state === 'connected') {
          if (connectionRecoveryTimerRef.current) {
            clearTimeout(connectionRecoveryTimerRef.current);
            connectionRecoveryTimerRef.current = null;
          }
          setSessionStatus('active');
          sessionStatusRef.current = 'active';
          setSessionMessage('Listening…');
          console.log('[Assistant] STATE → ACTIVE — starting 15s inactivity timer');

          // Auto-close after 15s of no activity (any data channel event resets this)
          if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
          inactivityTimerRef.current = setTimeout(() => {
            console.log('[Assistant] Inactivity timeout fired — closing session');
            inactivityTimerRef.current = null;
            endRealtimeSession();
          }, 15000);
        }

        if (state === 'disconnected') {
          if (!connectionRecoveryTimerRef.current) {
            setSessionMessage('Connection lost. Trying to recover...');
            connectionRecoveryTimerRef.current = setTimeout(() => {
              connectionRecoveryTimerRef.current = null;
              if (peerConnectionRef.current?.connectionState !== 'connected') {
                endRealtimeSession();
              }
            }, 5000);
          }
        }

        if (state === 'failed' || state === 'closed') {
          if (connectionRecoveryTimerRef.current) {
            clearTimeout(connectionRecoveryTimerRef.current);
            connectionRecoveryTimerRef.current = null;
          }
          endRealtimeSession();
        }
      };

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          peerConnection.addTrack(track, localStreamRef.current);
        });
      }

      const dataChannel = peerConnection.createDataChannel('oai-events');
      dataChannelRef.current = dataChannel;

      dataChannel.onopen = () => {
        console.log('[Pipeline] Step 3 — data channel open, waiting for session.created');
        setSessionMessage('Connecting...');
        // Configuration is sent when we receive session.created from OpenAI,
        // ensuring the session is fully initialised before we update it.
      };

      dataChannel.onmessage = (event) => {
        // Any incoming data channel message is a sign of activity — reset inactivity timer
        if (inactivityTimerRef.current) {
          clearTimeout(inactivityTimerRef.current);
          inactivityTimerRef.current = setTimeout(() => {
            console.log('[Assistant] Inactivity timeout fired — closing session');
            inactivityTimerRef.current = null;
            endRealtimeSession();
          }, 15000);
        }

        // Parse JSON separately so a malformed message never kills the session
        let payload;
        try {
          payload = JSON.parse(event.data);
        } catch (parseErr) {
          console.warn('[Pipeline] Data channel: non-JSON message received, ignoring:', event.data?.slice?.(0, 80));
          return;
        }

        console.log('[Pipeline] Data channel event:', payload.type);

        try {
          switch (payload.type) {
            case 'session.created':
              console.log('[Pipeline] Step 3 — session created by OpenAI, sending configuration');
              setSessionMessage('Listening...');
              sendSessionConfiguration();
              break;

            case 'session.updated':
              console.log('[Pipeline] Step 3 — session configuration acknowledged');
              break;

            case 'input_audio_buffer.speech_started':
              console.log('[Pipeline] Step 1 — speech detected by OpenAI VAD');
              setSessionMessage('Listening...');
              break;

            case 'input_audio_buffer.speech_stopped':
              console.log('[Pipeline] Step 1 — speech ended, OpenAI generating response');
              setSessionMessage('Processing...');
              break;

            case 'response.created':
              console.log('[Pipeline] Step 4 — AI response generation started');
              setSessionMessage('Processing...');
              break;

            case 'response.output_item.added':
              console.log('[Pipeline] Step 4 — AI output item added, type:', payload.item?.type);
              break;

            case 'response.audio.delta':
              // Audio frames arriving — pipeline is working
              console.log('[Pipeline] Step 5 — audio delta received (bytes)');
              break;

            case 'response.audio_transcript.delta':
              // Text of what the AI is saying
              console.log('[Pipeline] Step 4 — AI transcript delta:', payload.delta);
              break;

            case 'response.audio_transcript.done':
              console.log('[Pipeline] Step 4 — AI full transcript:', payload.transcript);
              break;

            case 'response.done':
            case 'response.output_item.done':
              console.log('[Pipeline] Step 4 — AI response complete');
              setSessionMessage('Listening...');
              break;

            case 'conversation.item.input_audio_transcription.completed':
              console.log('[Pipeline] Step 2 — user transcript:', payload.transcript);
              break;

            case 'session.disconnected':
              console.warn('[Pipeline] Session disconnected by server');
              endRealtimeSession();
              break;

            case 'error':
            case 'response.error': {
              const errMsg = payload.error?.message || JSON.stringify(payload.error) || 'Unknown error';
              console.error('[Pipeline] Server error event:', errMsg);
              // Only tear down for fatal errors
              if (payload.error?.code === 'session_expired' || payload.error?.code === 'invalid_api_key') {
                setSessionError(errMsg);
                setSessionMessage('');
                releaseRealtimeResources();
                setSessionStatus('error');
                sessionStatusRef.current = 'error';
                if (hideHotwordTimerRef.current) clearTimeout(hideHotwordTimerRef.current);
                hideHotwordTimerRef.current = setTimeout(() => {
                  setHotwordActive(false);
                  setSessionStatus('idle');
                  sessionStatusRef.current = 'idle';
                  setSessionError(null);
                }, 5000);
              }
              break;
            }

            default:
              // Non-critical events — log but don't act
              break;
          }
        } catch (handlerErr) {
          console.error('[Pipeline] Error handling event', payload.type, handlerErr);
        }
      };

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      const url = new URL('https://api.openai.com/v1/realtime');
      url.searchParams.set('model', assistantSettings.model || 'gpt-4o-mini-realtime-preview');

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${assistantSettings.apiKey}`,
          'Content-Type': 'application/sdp',
          'OpenAI-Beta': 'realtime=v1'
        },
        body: offer.sdp
      });

      if (!response.ok) {
        const errorMessage = await response.text();
        throw new Error(errorMessage || 'Failed to initialize realtime session.');
      }

      const answerSdp = await response.text();
      await peerConnection.setRemoteDescription({
        type: 'answer',
        sdp: answerSdp
      });

      setHotwordActive(true);
    } catch (error) {
      console.error('[Realtime] Status: failed —', error?.message || error);
      console.log('[Local Session] Realtime unavailable — Chat+TTS fallback remains active');
      releaseRealtimeResources();
      setSessionStatus('error');
      sessionStatusRef.current = 'error';
      setSessionError(error?.message || 'Unable to connect to the assistant.');
      setSessionMessage('Realtime unavailable — speak your command');

      if (hideHotwordTimerRef.current) {
        clearTimeout(hideHotwordTimerRef.current);
      }

      // After 5s, clear the error UI but keep localSessionActiveRef so Chat+TTS still works
      hideHotwordTimerRef.current = setTimeout(() => {
        setHotwordActive(false);
        setSessionStatus('idle');
        sessionStatusRef.current = 'idle';
        setSessionError(null);
        setSessionMessage('');
        // NOTE: localSessionActiveRef intentionally NOT reset here so commands still work
        console.log('[Local Session] Still active after Realtime error — Chat+TTS ready');
      }, 5000);
    }
  }, [
    activateHotword,
    aiAssistantSettings.enabled,
    assistantSettings,
    endRealtimeSession,
    releaseRealtimeResources,
    sendSessionConfiguration,
    setupAssistantVolumeMonitor
  ]);

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
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }
    if (cooldownTimerRef.current) {
      clearTimeout(cooldownTimerRef.current);
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
    setAiAssistantSettings(getAiAssistantSettings() || { enabled: false, settings: {} });
    setGeneralSettings(getGeneralSettings());

    // Listen for settings changes
    const handleStorageChange = () => {
      setEnabledApps(getVisibleApps());
      const updatedHandTrackingSettings = getAppSettings('handtracking');
      setHandTrackingEnabled(updatedHandTrackingSettings.enabled || false);
      setAiAssistantSettings(getAiAssistantSettings() || { enabled: false, settings: {} });
      setGeneralSettings(getGeneralSettings());
    };

    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      // Clean up any drag state on unmount
      clearDragState();
      if (hideHotwordTimerRef.current) {
        clearTimeout(hideHotwordTimerRef.current);
      }
      endRealtimeSession();
    };
  }, [clearDragState, endRealtimeSession]);

  useEffect(() => {
    let isCancelled = false;
    const w = /** @type {any} */ (window);
    const SpeechRecognition = w.SpeechRecognition || w.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn('Speech recognition is not supported in this browser.');
      setSpeechSupported(false);
      return undefined;
    }

    setSpeechSupported(true);
    setMicPermissionError('');

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;

    recognition.continuous = true;
    recognition.interimResults = false; // Final results only — reduces noise on Raspberry Pi
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      const assistantNameNormalized = assistantSettings.name?.trim().toLowerCase() || 'mirror';
      const hotwordPhrases = [`hey ${assistantNameNormalized}`];
      if (assistantNameNormalized !== 'mirror') {
        hotwordPhrases.push('hey mirror');
      }

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const isFinal = result.isFinal;
        const transcript = result[0].transcript.trim().toLowerCase();

        console.log(`[Speech] raw="${transcript}" isFinal=${isFinal} state=${sessionStatusRef.current}`);

        // Skip interim results (redundant guard since interimResults=false, but safe)
        if (!isFinal) {
          console.log('[Speech] Skipping interim result');
          continue;
        }

        setRawSpeechLog(prev => [...prev, transcript].slice(-50));

        // ── Cooldown: ignore everything for 2.5s after session closes ───────
        if (cooldownActiveRef.current) {
          console.log('[Speech] Cooldown active — transcript ignored');
          continue;
        }

        // ── STATE: IDLE — only listen for the wake word ──────────────────────
        // EXCEPTION: if local session is already active (Realtime failed/reset to idle
        // but localSessionActiveRef is still true), fall through to the command handler.
        if (sessionStatusRef.current === 'idle' && !localSessionActiveRef.current) {
          if (isWakeWord(transcript, hotwordPhrases)) {
            console.log('[Speech] Wake word detected! → activating assistant');
            console.log('[Local Session] Activated — Chat+TTS pipeline ready immediately');
            localSessionActiveRef.current = true;

            // 30s inactivity timer for local session — resets if no command arrives
            if (localSessionTimerRef.current) clearTimeout(localSessionTimerRef.current);
            localSessionTimerRef.current = setTimeout(() => {
              if (localSessionActiveRef.current) {
                console.log('[Local Session] Inactivity timeout — deactivating');
                localSessionActiveRef.current = false;
                localSessionTimerRef.current = null;
                window.speechSynthesis?.cancel();
                setHotwordActive(false);
                if (sessionStatusRef.current === 'idle') setSessionMessage('');
              }
            }, 30000);

            setHotwordDetected(true);
            if (hotwordDetectedTimerRef.current) clearTimeout(hotwordDetectedTimerRef.current);
            hotwordDetectedTimerRef.current = setTimeout(() => setHotwordDetected(false), 5000);

            console.log('[Realtime] Status: connecting — attempting WebRTC session');
            startRealtimeSession();
          } else {
            console.log('[Speech] STATE=IDLE, no local session — ignoring');
          }
          continue;
        }

        // ── COMMAND HANDLER — runs when Realtime is active OR local session is active ──
        // This block is reached when:
        //   a) sessionStatusRef.current !== 'idle'  (connecting / active / error)
        //   b) sessionStatusRef.current === 'idle' but localSessionActiveRef === true
        //      (Realtime errored and reset state back to idle, Chat+TTS still active)
        const sessionReady = sessionStatusRef.current === 'active' || localSessionActiveRef.current;
        if (sessionReady) {
          if (isCloseCommand(transcript)) {
            console.log(`[Speech] Close command: "${transcript}" → closing session`);
            console.log('[Local Session] Deactivated by close command');
            localSessionActiveRef.current = false;
            if (localSessionTimerRef.current) {
              clearTimeout(localSessionTimerRef.current);
              localSessionTimerRef.current = null;
            }
            window.speechSynthesis?.cancel();
            setSessionMessage('Closing…');
            if (sessionEndDelayTimerRef.current) clearTimeout(sessionEndDelayTimerRef.current);
            sessionEndDelayTimerRef.current = setTimeout(() => {
              sessionEndDelayTimerRef.current = null;
              endRealtimeSession();
            }, 800);
            break;
          }

          // Wake word inside an active/connecting session → it's noise, skip.
          // Wake word when Realtime has failed (status idle or error) but the local
          // session is still marked active → the user is re-activating; restart.
          if (isWakeWord(transcript, hotwordPhrases)) {
            const realtimeRunning =
              sessionStatusRef.current === 'active' ||
              sessionStatusRef.current === 'connecting';
            if (realtimeRunning) {
              console.log('[Speech] Skipping wake phrase (not a command)');
              continue;
            }
            // Zombie case (idle or error + localSessionActive) — restart.
            console.log('[Speech] Wake word during zombie local session → restarting');
            if (hideHotwordTimerRef.current) {
              clearTimeout(hideHotwordTimerRef.current);
              hideHotwordTimerRef.current = null;
            }
            if (localSessionTimerRef.current) {
              clearTimeout(localSessionTimerRef.current);
              localSessionTimerRef.current = null;
            }
            window.speechSynthesis?.cancel();
            localSessionActiveRef.current = true;
            localSessionTimerRef.current = setTimeout(() => {
              if (localSessionActiveRef.current) {
                console.log('[Local Session] Inactivity timeout — deactivating');
                localSessionActiveRef.current = false;
                localSessionTimerRef.current = null;
                window.speechSynthesis?.cancel();
                setHotwordActive(false);
                if (sessionStatusRef.current === 'idle') setSessionMessage('');
              }
            }, 30000);
            setHotwordDetected(true);
            if (hotwordDetectedTimerRef.current) clearTimeout(hotwordDetectedTimerRef.current);
            hotwordDetectedTimerRef.current = setTimeout(() => setHotwordDetected(false), 5000);
            console.log('[Realtime] Status: connecting — attempting WebRTC session');
            startRealtimeSession();
            continue;
          }

          if (!isValidCommand(transcript)) {
            console.log(`[Speech] Rejected (too short / noise): "${transcript}"`);
            continue;
          }

          console.log(`[Speech] Command accepted: "${transcript}"`);
          console.log(`[Realtime] Current status: ${sessionStatusRef.current}`);

          // Reset local inactivity timer on each valid command
          if (localSessionTimerRef.current) clearTimeout(localSessionTimerRef.current);
          localSessionTimerRef.current = setTimeout(() => {
            if (localSessionActiveRef.current) {
              console.log('[Local Session] Inactivity timeout — deactivating');
              localSessionActiveRef.current = false;
              localSessionTimerRef.current = null;
              window.speechSynthesis?.cancel();
              setHotwordActive(false);
              if (sessionStatusRef.current === 'idle') setSessionMessage('');
            }
          }, 30000);

          // Only use the Chat+TTS fallback when the WebRTC Realtime session is NOT
          // actively handling audio. When Realtime is 'active', the mic stream is
          // sent directly to OpenAI over WebRTC — calling handleUserCommand on top
          // of that fires two competing audio paths (browser TTS + WebRTC audio)
          // which interfere and produce no audible output.
          if (sessionStatusRef.current !== 'active') {
            console.log(`[Command] Dispatching to Chat+TTS fallback: "${transcript}"`);
            handleUserCommand(transcript);
          } else {
            console.log(`[Command] Realtime WebRTC active — mic stream already going to OpenAI, skipping Chat+TTS`);
          }
        }
      }
    };

    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setMicPermissionError('Microphone access was denied. Please allow microphone permissions in your browser settings.');
      } else if (event.error === 'no-speech') {
        setMicPermissionError('No speech detected. Try speaking louder or move closer to the microphone.');
      }
    };

    recognition.onend = () => {
      if (!isCancelled) {
        try {
          recognition.start();
        } catch (error) {
          console.error('Failed to restart speech recognition:', error);
        }
      }
    };

    try {
      recognition.start();
    } catch (error) {
      console.error('Failed to start speech recognition:', error);
    }

    return () => {
      isCancelled = true;

      if (hideHotwordTimerRef.current) {
        clearTimeout(hideHotwordTimerRef.current);
      }

      if (hotwordDetectedTimerRef.current) {
        clearTimeout(hotwordDetectedTimerRef.current);
      }

      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }

      if (cooldownTimerRef.current) {
        clearTimeout(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }

      if (recognitionRef.current) {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        try {
          recognitionRef.current.stop();
        } catch (error) {
          console.error('Failed to stop speech recognition:', error);
        }
      }
    };
  }, [assistantSettings.name, endRealtimeSession, handleUserCommand, startRealtimeSession]);

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

  const hotwordCircleStyle = useMemo(() => {
    const volume = Math.max(0, Math.min(assistantVolume, 1));
    const scale = 0.92 + volume * 0.35;
    const outer = 0.35 + volume * 0.28;
    const inner = 0.25 + volume * 0.22;
    const glow = 0.6 + volume * 0.25;
    const ring = Math.min(1, 0.75 + volume * 0.2);

    return {
      '--pulse-scale': scale.toFixed(3),
      '--pulse-outer-alpha': outer.toFixed(3),
      '--pulse-inner-alpha': inner.toFixed(3),
      '--pulse-glow-alpha': glow.toFixed(3),
      '--pulse-ring-opacity': ring.toFixed(3)
    };
  }, [assistantVolume]);

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
      <div
        role="dialog"
        aria-hidden={!hotwordActive}
        aria-live="assertive"
        className={`absolute inset-0 z-[999] flex items-center justify-center transition-all duration-500 ${
          hotwordActive
            ? 'pointer-events-auto opacity-100 backdrop-blur-md bg-black/25'
            : 'pointer-events-none opacity-0'
        }`}
      >
        <div className="flex flex-col items-center gap-6 text-white text-center max-w-md px-6">
          <div className="hotword-overlay-circle" style={hotwordCircleStyle} />
          <div className="space-y-3">
            <p className="text-2xl font-semibold tracking-wide">Hey Mirror</p>
            {sessionStatus === 'error' ? (
              <p className="text-sm text-red-200/90" aria-live="assertive">
                {sessionError}
              </p>
            ) : (
              sessionMessage && (
                <p className="text-sm text-white/80" aria-live="polite">
                  {sessionMessage}
                </p>
              )
            )}
            {sessionStatus !== 'error' && (
              <p className="text-xs uppercase tracking-[0.3em] text-white/50">
                Voice: {assistantSettings.voice || 'alloy'} • Model: {assistantSettings.model || 'gpt-4o-mini-realtime-preview'}
              </p>
            )}
          </div>
        </div>
      </div>
      <audio ref={remoteAudioElementRef} autoPlay playsInline className="hidden" />

      {/* One-time audio unlock banner — disappears after first interaction */}
      {aiAssistantSettings.enabled && !audioUnlocked && (
        <div
          className="absolute top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full text-xs text-white/70 bg-black/50 border border-white/10 backdrop-blur-sm cursor-pointer select-none"
          onClick={() => setAudioUnlocked(true)}
        >
          Tap anywhere to enable voice
        </div>
      )}

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

      {/* AI Assistant Debug Overlay */}
      {aiAssistantSettings.enabled && (
        <div className="absolute bottom-4 left-4 z-50 max-w-md bg-white/5 backdrop-blur-sm border border-white/10 rounded-lg p-4 text-white space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">AI Assistant</h3>
              <p className="text-xs text-gray-300">
                {sessionStatus === 'idle'
                  ? 'Waiting for Hey ' + (assistantSettings.name?.trim() || 'Mirror')
                  : sessionStatus === 'connecting'
                    ? 'Connecting...'
                    : sessionStatus === 'active'
                      ? 'Listening...'
                      : sessionStatus === 'error'
                        ? 'Error'
                        : 'Ready'}
              </p>
            </div>
            <div className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              sessionStatus === 'active'
                ? 'text-green-300 bg-green-500/15'
                : sessionStatus === 'connecting'
                  ? 'text-blue-300 bg-blue-500/15'
                  : sessionStatus === 'error'
                    ? 'text-red-300 bg-red-500/15'
                    : hotwordDetected
                      ? 'text-yellow-300 bg-yellow-500/15'
                      : 'text-gray-400'
            }`}>
              {sessionStatus === 'active'
                ? 'Active'
                : sessionStatus === 'connecting'
                  ? 'Connecting...'
                  : sessionStatus === 'error'
                    ? 'Error'
                    : hotwordDetected
                      ? 'Wake word!'
                      : 'Idle'}
            </div>
          </div>

          {!speechSupported && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/40 rounded px-2 py-1">
              This browser does not support speech recognition.
            </div>
          )}

          {micPermissionError && (
            <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/40 rounded px-2 py-1">
              {micPermissionError}
            </div>
          )}

          {assistantSettings.showRawTranscripts && (
            <div className="bg-black/40 border border-white/10 rounded p-2 max-h-40 overflow-y-auto text-xs space-y-1">
              {rawSpeechLog.length === 0 ? (
                <p className="text-gray-400 italic">Waiting for speech…</p>
              ) : (
                rawSpeechLog.map((entry, index) => (
                  <div key={index} className="text-gray-200">
                    {entry}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

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
