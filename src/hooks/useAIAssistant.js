import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getAiAssistantSettings } from '../data/aiAssistant';

// ── Free web tools (no extra API keys needed) ─────────────────────────────

async function toolWebSearch(query) {
  try {
    // DuckDuckGo Instant Answers — free, no key
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
      { signal: AbortSignal.timeout(6000) }
    );
    const d = await res.json();
    const text = d.AbstractText || d.Answer || '';
    if (text) return text;
    const related = (d.RelatedTopics || [])
      .slice(0, 4)
      .map(t => t.Text)
      .filter(Boolean)
      .join(' | ');
    return related || `No instant answer for "${query}". Try rephrasing.`;
  } catch (e) {
    return `Search failed: ${e.message}`;
  }
}

async function toolWikipedia(topic) {
  try {
    const slug = encodeURIComponent(topic.trim().replace(/ /g, '_'));
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) throw new Error('not found');
    const d = await res.json();
    return d.extract || 'No summary available.';
  } catch {
    return await toolWebSearch(topic);
  }
}

async function toolWeather(location) {
  try {
    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&format=json`,
      { signal: AbortSignal.timeout(6000) }
    );
    const geo = await geoRes.json();
    const place = geo.results?.[0];
    if (!place) return `Could not find location: "${location}"`;

    const { latitude, longitude, name, country } = place;
    const wRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&current=temperature_2m,apparent_temperature,weathercode,windspeed_10m,relative_humidity_2m,precipitation` +
      `&temperature_unit=celsius&windspeed_unit=kmh`,
      { signal: AbortSignal.timeout(6000) }
    );
    const w = await wRes.json();
    const c = w.current;
    const cond = wmoDescription(c.weathercode);
    return (
      `${name}, ${country}: ${c.temperature_2m}°C (feels like ${c.apparent_temperature}°C), ` +
      `${cond}. Wind ${c.windspeed_10m} km/h, humidity ${c.relative_humidity_2m}%, ` +
      `precipitation ${c.precipitation} mm.`
    );
  } catch (e) {
    return `Weather lookup failed: ${e.message}`;
  }
}

function wmoDescription(code) {
  if (code === 0) return 'clear sky';
  if (code <= 3) return 'partly cloudy';
  if (code <= 9) return 'foggy conditions';
  if (code <= 29) return 'drizzle';
  if (code <= 39) return 'rain';
  if (code <= 49) return 'snow';
  if (code <= 59) return 'fog';
  if (code <= 69) return 'freezing drizzle';
  if (code <= 79) return 'snow fall';
  if (code <= 84) return 'rain showers';
  if (code <= 94) return 'thunderstorm';
  return 'severe thunderstorm';
}

function toolDatetime() {
  const now = new Date();
  return now.toLocaleString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
  });
}

// ── Tool registry ─────────────────────────────────────────────────────────

const TOOLS_OPENAI = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the internet for current information, news, or any facts you are unsure about. Use this whenever the question involves recent events or real-world data.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Search query' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get current weather conditions for any city or location in the world.',
      parameters: {
        type: 'object',
        properties: { location: { type: 'string', description: 'City or place name' } },
        required: ['location'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_datetime',
      description: 'Get the current date and time.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wikipedia_search',
      description: 'Look up detailed background information about any topic on Wikipedia.',
      parameters: {
        type: 'object',
        properties: { topic: { type: 'string', description: 'Topic to search' } },
        required: ['topic'],
      },
    },
  },
];

// Realtime API uses a flatter tool schema
const TOOLS_REALTIME = TOOLS_OPENAI.map(t => ({
  type: 'function',
  name: t.function.name,
  description: t.function.description,
  parameters: t.function.parameters,
}));

async function executeTool(name, args) {
  switch (name) {
    case 'web_search':      return await toolWebSearch(args.query || '');
    case 'get_weather':     return await toolWeather(args.location || '');
    case 'get_datetime':    return toolDatetime();
    case 'wikipedia_search': return await toolWikipedia(args.topic || '');
    default:                return `Unknown tool: ${name}`;
  }
}

// ── Lightweight RAG (conversation memory) ────────────────────────────────

const HISTORY_KEY = 'sm_ai_conversation';
const MAX_STORED   = 40; // turns to persist in localStorage
const MAX_CONTEXT  = 8;  // turns to include in each request

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
  catch { return []; }
}

function saveHistory(history) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-MAX_STORED))); }
  catch {}
}

/** Simple keyword retrieval: find past turns most relevant to the current query. */
function retrieveContext(history, query) {
  if (!history.length || !query) return [];
  const keywords = query.toLowerCase().split(/\W+/).filter(w => w.length > 3);
  if (!keywords.length) return [];
  const scored = history
    .map((h, idx) => ({
      ...h,
      score: keywords.filter(kw => (h.content || '').toLowerCase().includes(kw)).length,
      idx,
    }))
    .filter(h => h.score > 0)
    .sort((a, b) => b.score - a.score || b.idx - a.idx)
    .slice(0, 4);
  return scored.map(({ score, idx, ...h }) => h);
}

// ── Main hook ─────────────────────────────────────────────────────────────

export function useAIAssistant() {
  // ── Settings ─────────────────────────────────────────────────────────
  const [rawSettings, setRawSettings] = useState(() => getAiAssistantSettings());

  const cfg = useMemo(() => {
    const s = rawSettings.settings || {};
    return {
      enabled:           Boolean(rawSettings.enabled),
      apiKey:            (s.apiKey || '').trim(),
      // Chat model — latest gpt-4o family by default
      chatModel:         s.chatModel || s.model?.includes('realtime') ? 'gpt-4o' : (s.model || 'gpt-4o'),
      // Realtime WebRTC model
      realtimeModel:     s.realtimeModel || 'gpt-4o-realtime-preview-2024-12-17',
      voice:             s.voice || 'alloy',
      name:              s.name || 'Mirror',
      elevenLabsKey:     (s.elevenLabsKey || '').trim(),
      elevenLabsVoiceId: (s.elevenLabsVoiceId || '').trim() || 'JBFqnCBsd6RMkjVDRZzb',
    };
  }, [rawSettings]);

  // Keep a ref so callbacks never go stale
  const cfgRef = useRef(cfg);
  useEffect(() => { cfgRef.current = cfg; }, [cfg]);

  // ── UI state ──────────────────────────────────────────────────────────
  const [isOpen,      setIsOpen]      = useState(false);
  const [status,      setStatus]      = useState('idle');
  // idle | connecting | listening | thinking | speaking | error
  const [statusMsg,   setStatusMsg]   = useState('');
  const [errorMsg,    setErrorMsg]    = useState('');
  const [volume,      setVolume]      = useState(0);
  const [userText,    setUserText]    = useState('');   // last user utterance
  const [aiText,      setAiText]      = useState('');   // streaming AI response
  const [history,     setHistory]     = useState(() => loadHistory());
  const [speechOk,    setSpeechOk]    = useState(false);
  const [micError,    setMicError]    = useState('');

  // ── Imperative refs ───────────────────────────────────────────────────
  const isOpenRef       = useRef(false);
  const statusRef       = useRef('idle');
  const cooldownRef     = useRef(false);
  const sessionRef      = useRef(false);  // local Chat+TTS session active
  const inactivityRef   = useRef(null);
  const abortRef        = useRef(null);

  // WebRTC
  const pcRef           = useRef(null);
  const dcRef           = useRef(null);
  const micStreamRef    = useRef(null);
  const remoteAudioRef  = useRef(null);  // rendered by SmartMirror as <audio>
  const audioCtxRef     = useRef(null);
  const analyserRef     = useRef(null);
  const volRafRef       = useRef(null);
  const audioUnlockedRef = useRef(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const ttsAudioRef     = useRef(null);  // ElevenLabs TTS playback

  // Speech recognition
  const recognitionRef  = useRef(null);

  // ── Sync refs ─────────────────────────────────────────────────────────
  useEffect(() => { isOpenRef.current  = isOpen;  }, [isOpen]);
  useEffect(() => { statusRef.current  = status;  }, [status]);

  // ── Settings reload ───────────────────────────────────────────────────
  useEffect(() => {
    const handler = () => setRawSettings(getAiAssistantSettings());
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────

  const setUiStatus = useCallback((s, msg = '', err = '') => {
    setStatus(s);
    statusRef.current = s;
    setStatusMsg(msg);
    setErrorMsg(err);
  }, []);

  const open = useCallback(() => {
    setIsOpen(true);
    isOpenRef.current = true;
  }, []);

  // ── Audio ─────────────────────────────────────────────────────────────

  const playDing = useCallback(async () => {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AC();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') await ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const t = ctx.currentTime;
      osc.frequency.setValueAtTime(880, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.65);
    } catch {}
  }, []);

  const speak = useCallback(async (text) => {
    if (!text) return;
    const { elevenLabsKey, elevenLabsVoiceId } = cfgRef.current;

    // Stop any currently playing TTS audio
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current = null;
    }

    if (elevenLabsKey) {
      try {
        const res = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${elevenLabsVoiceId}`,
          {
            method: 'POST',
            headers: {
              'xi-api-key': elevenLabsKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              text,
              model_id: 'eleven_turbo_v2_5',
              voice_settings: { stability: 0.5, similarity_boost: 0.75 },
            }),
          }
        );
        if (!res.ok) throw new Error(`ElevenLabs ${res.status}`);
        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        const audio = new Audio(url);
        ttsAudioRef.current = audio;
        audio.onended = () => URL.revokeObjectURL(url);
        await audio.play();
        return;
      } catch (err) {
        console.error('[TTS] ElevenLabs error, falling back to browser TTS:', err);
      }
    }

    // Fallback: browser speechSynthesis
    if (!window.speechSynthesis) return;
    const go = () => {
      // Chrome bug: cancel() + immediate speak() = silence — wait one tick
      window.speechSynthesis.cancel();
      setTimeout(() => {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
        const utt = new SpeechSynthesisUtterance(text);
        utt.lang = 'en-US';
        utt.onerror = (e) => console.error('[TTS] SpeechSynthesis error:', e.error);
        window.speechSynthesis.speak(utt);
      }, 50);
    };
    if (window.speechSynthesis.getVoices().length > 0) {
      go();
    } else {
      window.speechSynthesis.addEventListener('voiceschanged', go, { once: true });
    }
  }, []);

  // ── Volume monitor ────────────────────────────────────────────────────

  const stopVolume = useCallback(() => {
    if (volRafRef.current) { cancelAnimationFrame(volRafRef.current); volRafRef.current = null; }
    try { analyserRef.current?.disconnect(); } catch {}
    analyserRef.current = null;
    setVolume(0);
  }, []);

  const startVolume = useCallback((stream) => {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !stream) return;
    stopVolume();
    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AC();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const src = ctx.createMediaStreamSource(stream);
      const an  = ctx.createAnalyser();
      an.fftSize = 256;
      an.smoothingTimeConstant = 0.6;
      src.connect(an);
      analyserRef.current = an;
      const data = new Uint8Array(an.frequencyBinCount);
      const tick = () => {
        if (!analyserRef.current) return;
        an.getByteFrequencyData(data);
        const avg = data.reduce((s, v) => s + v, 0) / data.length;
        const v = Math.min(Math.pow(avg / 128, 0.6) * 1.4, 1);
        setVolume(p => p * 0.65 + v * 0.35);
        volRafRef.current = requestAnimationFrame(tick);
      };
      volRafRef.current = requestAnimationFrame(tick);
    } catch {}
  }, [stopVolume]);

  // ── Session management ────────────────────────────────────────────────

  const resetInactivity = useCallback(() => {
    if (inactivityRef.current) clearTimeout(inactivityRef.current);
    inactivityRef.current = setTimeout(() => {
      if (!isOpenRef.current) return;
      console.log('[AI] Inactivity timeout — closing');
      // trigger close via endSession which is defined below
      // we call it indirectly via ref to avoid circular dep
      endSessionRef.current?.();
    }, 25000);
  }, []);

  const endSessionRef = useRef(null); // will be set after endSession is defined

  const releaseWebRTC = useCallback(() => {
    if (dcRef.current) {
      try { dcRef.current.close(); } catch {}
      dcRef.current.onmessage = null;
      dcRef.current = null;
    }
    if (pcRef.current) {
      try { pcRef.current.close(); } catch {}
      pcRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => { try { t.stop(); } catch {} });
      micStreamRef.current = null;
    }
    if (remoteAudioRef.current) {
      try { remoteAudioRef.current.pause(); } catch {}
      remoteAudioRef.current.srcObject = null;
    }
    stopVolume();
  }, [stopVolume]);

  const endSession = useCallback(() => {
    sessionRef.current = false;
    if (inactivityRef.current) { clearTimeout(inactivityRef.current); inactivityRef.current = null; }
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
    if (ttsAudioRef.current) { ttsAudioRef.current.pause(); ttsAudioRef.current = null; }
    window.speechSynthesis?.cancel();
    releaseWebRTC();
    setIsOpen(false);
    isOpenRef.current = false;
    setUiStatus('idle', '');
    setUserText('');
    setAiText('');
    // Short cooldown so wake word doesn't immediately re-trigger
    cooldownRef.current = true;
    setTimeout(() => { cooldownRef.current = false; }, 2200);
  }, [releaseWebRTC, setUiStatus]);

  // Wire the indirect ref so resetInactivity can call endSession
  useEffect(() => { endSessionRef.current = endSession; }, [endSession]);

  // ── WebRTC Realtime session ───────────────────────────────────────────

  const configureRealtimeSession = useCallback(() => {
    if (!dcRef.current) return;
    const { name, voice } = cfgRef.current;
    dcRef.current.send(JSON.stringify({
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        voice,
        instructions: `You are ${name}, a smart AI assistant built into a smart mirror. Be concise, warm, and helpful. When asked about weather, time, facts, or news — use your tools. Keep spoken answers to 1-3 sentences unless asked to elaborate.`,
        turn_detection: { type: 'server_vad', threshold: 0.45, prefix_padding_ms: 250, silence_duration_ms: 500 },
        input_audio_transcription: { model: 'whisper-1' },
        tools: TOOLS_REALTIME,
        tool_choice: 'auto',
      },
    }));
  }, []);

  const startWebRTC = useCallback(async () => {
    const { apiKey, realtimeModel } = cfgRef.current;
    if (!apiKey) {
      setUiStatus('error', '', 'Add your OpenAI API key in Settings → AI Assistant.');
      return;
    }
    if (statusRef.current === 'connecting') return;

    try {
      setUiStatus('connecting', 'Connecting…');

      if (!micStreamRef.current) {
        micStreamRef.current = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
        });
        // Unlock audio autoplay
        if (remoteAudioRef.current && !audioUnlockedRef.current) {
          const audio = remoteAudioRef.current;
          audio.muted = true;
          const p = audio.play();
          if (p?.then) p.then(() => {
            audio.pause(); audio.muted = false; audio.currentTime = 0;
            audioUnlockedRef.current = true; setAudioUnlocked(true);
          }).catch(() => { audio.muted = false; });
        }
      }

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      pc.ontrack = (ev) => {
        const stream = ev.streams?.[0] || (ev.track ? new MediaStream([ev.track]) : null);
        if (!stream || !remoteAudioRef.current) return;
        const audio = remoteAudioRef.current;
        audio.srcObject = stream;
        // Never mute — we need actual audio output.
        // autoPlay on the element handles the initial play; call play() here as a belt-and-suspenders.
        audio.muted = false;
        audio.volume = 1;
        const tryPlay = (n) => {
          const p = audio.play();
          if (p?.then) {
            p.then(() => {
              audioUnlockedRef.current = true;
              setAudioUnlocked(true);
              console.log('[WebRTC] Audio playing');
            }).catch(err => {
              console.warn(`[WebRTC] play() attempt ${n} failed: ${err.message}`);
              if (n < 8) setTimeout(() => tryPlay(n + 1), 300);
            });
          }
        };
        tryPlay(1);
        startVolume(stream);
      };

      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        if (s === 'connected') {
          setUiStatus('listening', 'Listening…');
          resetInactivity();
        } else if (s === 'failed' || s === 'closed') {
          endSession();
        }
      };

      micStreamRef.current.getTracks().forEach(t => pc.addTrack(t, micStreamRef.current));

      const dc = pc.createDataChannel('oai-events');
      dcRef.current = dc;

      let partialAi = '';
      const pendingCalls = {};

      dc.onopen = () => setStatusMsg('Connecting…');

      dc.onmessage = (ev) => {
        resetInactivity();
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }

        switch (msg.type) {
          case 'session.created':
            configureRealtimeSession();
            setUiStatus('listening', 'Listening…');
            break;

          case 'input_audio_buffer.speech_started':
            setUiStatus('listening', 'Listening…');
            setUserText('');
            partialAi = '';
            setAiText('');
            break;

          case 'input_audio_buffer.speech_stopped':
            setUiStatus('thinking', 'Processing…');
            break;

          case 'conversation.item.input_audio_transcription.completed': {
            const t = msg.transcript || '';
            setUserText(t);
            if (t) setHistory(prev => { const u = [...prev, { role: 'user', content: t }]; saveHistory(u); return u; });
            break;
          }

          case 'response.audio_transcript.delta':
            partialAi += msg.delta || '';
            setAiText(partialAi);
            setUiStatus('speaking', 'Speaking…');
            break;

          case 'response.audio_transcript.done': {
            const full = msg.transcript || partialAi;
            setAiText(full);
            if (full) setHistory(prev => { const u = [...prev, { role: 'assistant', content: full }]; saveHistory(u); return u; });
            partialAi = '';
            break;
          }

          case 'response.done':
            setUiStatus('listening', 'Listening…');
            break;

          // Tool call handling
          case 'response.output_item.added':
            if (msg.item?.type === 'function_call') {
              pendingCalls[msg.item.call_id] = { name: msg.item.name, args: '' };
            }
            break;

          case 'response.function_call_arguments.delta':
            if (pendingCalls[msg.call_id]) pendingCalls[msg.call_id].args += msg.delta || '';
            break;

          case 'response.function_call_arguments.done': {
            const call = pendingCalls[msg.call_id];
            if (!call) break;
            setUiStatus('thinking', `Looking up: ${call.name.replace(/_/g, ' ')}…`);
            let args = {};
            try { args = JSON.parse(call.args || '{}'); } catch {}
            executeTool(call.name, args).then(result => {
              if (!dcRef.current) return;
              dcRef.current.send(JSON.stringify({
                type: 'conversation.item.create',
                item: { type: 'function_call_output', call_id: msg.call_id, output: String(result) },
              }));
              dcRef.current.send(JSON.stringify({ type: 'response.create' }));
            });
            delete pendingCalls[msg.call_id];
            break;
          }

          case 'error': {
            const code = msg.error?.code;
            if (code === 'invalid_api_key') setUiStatus('error', '', 'Invalid API key. Check Settings.');
            else if (code === 'session_expired') endSession();
            break;
          }
          default: break;
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const res = await fetch(
        `https://api.openai.com/v1/realtime?model=${encodeURIComponent(realtimeModel)}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/sdp',
            'OpenAI-Beta': 'realtime=v1',
          },
          body: offer.sdp,
        }
      );

      if (!res.ok) throw new Error(await res.text());
      await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });

    } catch (err) {
      console.error('[WebRTC] Failed:', err.message);
      releaseWebRTC();
      // Fall through to Chat+TTS mode — session stays open, mic commands still work
      setUiStatus('listening', 'Voice ready (fallback mode)');
      sessionRef.current = true;
      resetInactivity();
    }
  }, [configureRealtimeSession, endSession, releaseWebRTC, resetInactivity, setUiStatus, startVolume]);

  // ── Chat + TTS agentic pipeline ───────────────────────────────────────

  const sendChatMessage = useCallback(async (userMessage) => {
    const { apiKey, chatModel, name } = cfgRef.current;
    if (!apiKey) {
      setUiStatus('error', '', 'Add your OpenAI API key in Settings → AI Assistant.');
      return;
    }

    setUiStatus('thinking', 'Thinking…');
    setUserText(userMessage);
    setAiText('');

    const newHistory = [...history, { role: 'user', content: userMessage }];
    setHistory(newHistory);
    saveHistory(newHistory);

    const contextTurns = retrieveContext(history, userMessage);
    const recent = newHistory.slice(-MAX_CONTEXT);

    // Merge context + recent, deduplicate
    const allTurns = [...contextTurns, ...recent].reduce((acc, m) => {
      if (!acc.some(e => e.role === m.role && e.content === m.content)) acc.push(m);
      return acc;
    }, []);

    const systemPrompt =
      `You are ${name}, a smart AI assistant embedded in a smart mirror. ` +
      `Today is ${toolDatetime()}. ` +
      `Be concise and conversational. ` +
      `Use your tools proactively whenever the user asks about real-world data, weather, news, facts, or time. ` +
      `Keep responses to 2-3 sentences for spoken answers unless the user asks for more detail.`;

    const messages = [{ role: 'system', content: systemPrompt }, ...allTurns];

    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    try {
      let currentMessages = messages;

      // Agentic loop — model calls tools until it returns a final response
      for (let iter = 0; iter < 6; iter++) {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          signal: abortRef.current.signal,
          body: JSON.stringify({
            model: chatModel,
            messages: currentMessages,
            tools: TOOLS_OPENAI,
            tool_choice: 'auto',
            max_tokens: 600,
          }),
        });

        if (!res.ok) {
          const body = await res.text();
          throw new Error(`API ${res.status}: ${body}`);
        }

        const data = await res.json();
        const choice = data.choices?.[0];
        if (!choice) throw new Error('No response');

        if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls?.length) {
          currentMessages = [...currentMessages, choice.message];

          const toolResults = await Promise.all(
            choice.message.tool_calls.map(async tc => {
              const label = tc.function.name.replace(/_/g, ' ');
              setUiStatus('thinking', `Looking up: ${label}…`);
              let args = {};
              try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
              const output = await executeTool(tc.function.name, args);
              return { role: 'tool', tool_call_id: tc.id, content: String(output) };
            })
          );

          currentMessages = [...currentMessages, ...toolResults];
          continue;
        }

        // Final text response
        const responseText = (choice.message?.content || '').trim();
        if (!responseText) break;

        setAiText(responseText);
        setUiStatus('speaking', 'Speaking…');
        speak(responseText);

        const updatedHistory = [...newHistory, { role: 'assistant', content: responseText }];
        setHistory(updatedHistory);
        saveHistory(updatedHistory);

        setTimeout(() => setUiStatus('listening', 'Listening…'), 400);
        return;
      }

      setUiStatus('listening', 'Listening…');
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('[Chat] Error:', err.message);
      setUiStatus('error', '', err.message);
      setTimeout(() => setUiStatus('listening', 'Listening…'), 4000);
    }
  }, [history, setUiStatus, speak]);

  // Keep a ref so the speech handler can always call the latest sendChatMessage
  const sendChatRef = useRef(sendChatMessage);
  useEffect(() => { sendChatRef.current = sendChatMessage; }, [sendChatMessage]);

  // ── Public send (text input / debug) ─────────────────────────────────

  const sendText = useCallback((text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!isOpenRef.current) { open(); sessionRef.current = true; }
    resetInactivity();

    if (dcRef.current?.readyState === 'open') {
      dcRef.current.send(JSON.stringify({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: trimmed }] },
      }));
      dcRef.current.send(JSON.stringify({ type: 'response.create' }));
      setUserText(trimmed);
    } else {
      sendChatRef.current(trimmed);
    }
  }, [open, resetInactivity]);

  // ── Speech recognition ────────────────────────────────────────────────
  // Uses a handler ref pattern so the onresult closure never goes stale.

  const speechHandlerRef = useRef(null);

  // Rebuild the handler whenever key values change
  speechHandlerRef.current = (text) => {
    if (cooldownRef.current) return;

    const { name, enabled } = cfgRef.current;
    const nameLower = (name || 'mirror').toLowerCase();
    const wakeWords = [`hey ${nameLower}`, 'hey mirror'];
    const isWake = wakeWords.some(w => text.includes(w));
    const isClose = ['thank you', 'thanks', 'close', 'stop', 'goodbye', 'bye', 'dismiss']
      .some(w => text.includes(w));

    if (!isOpenRef.current) {
      // ── Idle: only listen for wake word ──────────────────────────────
      if (!isWake) return;

      console.log('[Speech] Wake word →', text);
      playDing();
      open();
      sessionRef.current = true;

      if (!enabled) {
        setUiStatus('error', '', 'AI assistant is disabled. Enable it in Settings → AI Assistant.');
        setTimeout(() => endSessionRef.current?.(), 4000);
        return;
      }

      startWebRTC();
      resetInactivity();

    } else {
      // ── Session open: handle commands ─────────────────────────────────
      if (isClose) {
        endSessionRef.current?.();
        return;
      }

      // Ignore the wake word re-trigger inside an active session
      if (isWake) return;

      // Ignore single-word noise
      if (text.split(/\s+/).length < 2) return;

      resetInactivity();

      // Only use Chat+TTS when WebRTC isn't actively receiving audio
      if (!dcRef.current || dcRef.current.readyState !== 'open') {
        sendChatRef.current(text);
      }
      // When WebRTC is open, the mic stream goes directly to OpenAI
    }
  };

  useEffect(() => {
    const W = window;
    const SR = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!SR) { setSpeechOk(false); return; }

    setSpeechOk(true);
    const rec = new SR();
    recognitionRef.current = rec;
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = 'en-US';

    let cancelled = false;

    rec.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (!ev.results[i].isFinal) continue;
        const text = ev.results[i][0].transcript.trim().toLowerCase();
        console.log('[Speech]', text);
        speechHandlerRef.current(text);
      }
    };

    rec.onerror = (ev) => {
      console.warn('[Speech] Error:', ev.error);
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        setMicError('Microphone access denied. Allow microphone permissions in your browser.');
      }
    };

    rec.onend = () => { if (!cancelled) { try { rec.start(); } catch {} } };

    try { rec.start(); } catch (e) { console.error('[Speech] Could not start:', e); }

    return () => {
      cancelled = true;
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try { rec.stop(); } catch {}
    };
  }, []); // Run once — handler ref keeps values fresh

  // ── Audio unlock on first interaction ────────────────────────────────
  useEffect(() => {
    const unlock = () => {
      if (audioUnlockedRef.current) return;
      const audio = remoteAudioRef.current;
      if (!audio) return;
      audio.muted = true;
      const p = audio.play();
      if (p?.then) p.then(() => {
        audio.pause(); audio.muted = false; audio.currentTime = 0;
        audioUnlockedRef.current = true; setAudioUnlocked(true);
      }).catch(() => { audio.muted = false; });
    };
    const events = ['click', 'touchstart', 'keydown', 'pointerdown'];
    events.forEach(e => document.addEventListener(e, unlock, { capture: true }));
    return () => events.forEach(e => document.removeEventListener(e, unlock, { capture: true }));
  }, []);

  // ── Cleanup on unmount ────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (inactivityRef.current) clearTimeout(inactivityRef.current);
      if (abortRef.current) abortRef.current.abort();
      releaseWebRTC();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Explicit audio unlock (call on any user gesture) ─────────────────
  const unlockAudio = useCallback(() => {
    // Unlock WebRTC audio element
    if (remoteAudioRef.current && !audioUnlockedRef.current) {
      const audio = remoteAudioRef.current;
      audio.muted = true;
      const p = audio.play();
      if (p?.then) p.then(() => {
        audio.pause();
        audio.muted = false;
        audio.currentTime = 0;
        audioUnlockedRef.current = true;
        setAudioUnlocked(true);
      }).catch(() => { audio.muted = false; });
    }
  }, []);

  // ── Public API ────────────────────────────────────────────────────────
  return {
    // State
    isOpen,
    status,
    statusMsg,
    errorMsg,
    volume,
    userText,
    aiText,
    history,
    speechOk,
    micError,
    audioUnlocked,
    cfg,
    // Refs (for rendering in SmartMirror)
    remoteAudioRef,
    // Actions
    open,
    endSession,
    sendText,
    unlockAudio,
    clearHistory: () => { setHistory([]); localStorage.removeItem(HISTORY_KEY); },
  };
}
