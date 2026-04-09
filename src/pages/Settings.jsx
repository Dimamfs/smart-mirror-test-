import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { apps, saveAppSettings, toggleAppEnabled } from '../data/apps';
import { getUsers, setActiveUser, migrateUsersIfNeeded } from '../data/users';
import {
  getAiAssistantSettings,
  saveAiAssistantSettings,
  setAiAssistantEnabled
} from '../data/aiAssistant';
import {
  ACCENT_OPTIONS,
  FONT_OPTIONS,
  getAccentOption,
  getFontOption,
  getGeneralSettings,
  saveGeneralSettings
} from '../data/generalSettings';
import { LANGUAGES } from '../data/translations';
import { CAMERA_POSITION_OPTIONS } from '../utils/handTracking';

const REALTIME_MODELS = [
  { value: 'gpt-4o-realtime-preview-2024-12-17', label: 'GPT-4o Realtime (Dec 2024) — recommended' },
  { value: 'gpt-4o-mini-realtime-preview-2024-12-17', label: 'GPT-4o mini Realtime (Dec 2024) — faster' },
  { value: 'gpt-4o-realtime-preview', label: 'GPT-4o Realtime (latest alias)' },
  { value: 'gpt-4o-mini-realtime-preview', label: 'GPT-4o mini Realtime (latest alias)' },
];

const CHAT_MODELS = [
  { value: 'gpt-4o',          label: 'GPT-4o — recommended' },
  { value: 'gpt-4o-mini',     label: 'GPT-4o mini — faster & cheaper' },
  { value: 'gpt-4.1',         label: 'GPT-4.1' },
  { value: 'gpt-4.1-mini',    label: 'GPT-4.1 mini' },
  { value: 'gpt-4-turbo',     label: 'GPT-4 Turbo' },
];

const VOICE_OPTIONS = [
  { value: 'alloy',   label: 'Alloy' },
  { value: 'ash',     label: 'Ash' },
  { value: 'ballad',  label: 'Ballad' },
  { value: 'coral',   label: 'Coral' },
  { value: 'echo',    label: 'Echo' },
  { value: 'sage',    label: 'Sage' },
  { value: 'shimmer', label: 'Shimmer' },
  { value: 'verse',   label: 'Verse' },
  { value: 'aria',    label: 'Aria' },
];

const Settings = () => {
  const [settings, setSettings] = useState({});
  const [selectedApp, setSelectedApp] = useState(null);
  const [generalSettings, setGeneralSettings] = useState(() => getGeneralSettings());
  const [aiAssistantSettings, setAiAssistantSettings] = useState(() => getAiAssistantSettings());
  const [showApiKey, setShowApiKey] = useState(false);
  const [spotifyAuthState, setSpotifyAuthState] = useState({ status: 'idle', message: '' });
  const [usersState, setUsersState] = useState(() => { migrateUsersIfNeeded(); return getUsers(); });
  const assistantSettings = aiAssistantSettings.settings || {};
  const selectedAccent = getAccentOption(generalSettings.accent);
  const selectedFont = getFontOption(generalSettings.font);

  useEffect(() => {
    const savedSettings = JSON.parse(localStorage.getItem('smartMirrorSettings') || '{}');
    const resolvedGeneral = getGeneralSettings();
    setSettings({ ...savedSettings, general: resolvedGeneral });
    setGeneralSettings(resolvedGeneral);
    setAiAssistantSettings(getAiAssistantSettings());
  }, []);

  const handleToggleApp = (appId, enabled) => {
    toggleAppEnabled(appId, enabled);
    setSettings(prev => ({
      ...prev,
      [appId]: {
        ...prev[appId],
        enabled
      }
    }));
    
    // Trigger storage event for other components
    window.dispatchEvent(new Event('storage'));
  };

  const handleSettingChange = (appId, settingKey, value, options = {}) => {
    const newSettings = {
      ...settings,
      [appId]: {
        ...settings[appId],
        settings: {
          ...settings[appId]?.settings,
          [settingKey]: value
        }
      }
    };

    if (appId === 'spotify' && options.resetSpotifyAuthState !== false) {
      setSpotifyAuthState(prev => (prev.status === 'idle' ? prev : { status: 'idle', message: '' }));
    }

    setSettings(newSettings);
    saveAppSettings(appId, { [settingKey]: value });

    // Trigger storage event for other components
    window.dispatchEvent(new Event('storage'));
  };

  const handleSpotifyAuthenticate = async () => {
    const username = (getAppSetting('spotify', 'username', '') || '').trim();
    const clientId = (getAppSetting('spotify', 'clientId', '') || '').trim();
    const clientSecret = (getAppSetting('spotify', 'clientSecret', '') || '').trim();

    if (!clientId || !clientSecret || !username) {
      setSpotifyAuthState({
        status: 'error',
        message: 'Enter your Spotify username, client ID, and client secret before authenticating.'
      });
      return;
    }

    setSpotifyAuthState({ status: 'pending', message: 'Opening Spotify authorization…' });

    try {
      const response = await fetch('/spotify/authenticate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ clientId, clientSecret, username })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Unable to start Spotify authentication.');
      }

      const authUrl =
        data.authorizationUrl || data.redirectUrl || data.url || data.loginUrl || null;
      if (authUrl) {
        const popup = window.open(authUrl, '_blank', 'width=520,height=720');
        if (!popup) {
          window.location.href = authUrl;
        }
        setSpotifyAuthState({
          status: 'info',
          message: 'Complete the Spotify sign-in in the newly opened window.'
        });
      }

      if (data.authenticated || data.status === 'authenticated') {
        const timestamp = new Date().toISOString();
        handleSettingChange('spotify', 'lastAuthenticatedAt', timestamp, { resetSpotifyAuthState: false });
        setSpotifyAuthState({ status: 'success', message: 'Spotify account authenticated.' });
      } else if (!authUrl) {
        setSpotifyAuthState({
          status: 'success',
          message: 'Spotify credentials saved. Continue the login flow if prompted by Spotify.'
        });
      }

      if (data.tokenExpiresAt) {
        handleSettingChange('spotify', 'tokenExpiresAt', data.tokenExpiresAt, { resetSpotifyAuthState: false });
      }
    } catch (error) {
      console.error('Spotify authentication failed', error);
      setSpotifyAuthState({
        status: 'error',
        message: error.message || 'Unable to authenticate with Spotify.'
      });
    }
  };

  const isAppEnabled = (appId) => {
    return settings[appId]?.enabled !== false; // Default to true
  };

  const getAppSetting = (appId, settingKey, defaultValue) => {
    return settings[appId]?.settings?.[settingKey] ?? defaultValue;
  };

  const handleToggleAiAssistant = (enabled) => {
    setAiAssistantEnabled(enabled);
    setAiAssistantSettings(prev => ({
      ...prev,
      enabled
    }));
    window.dispatchEvent(new Event('storage'));
  };

  const handleAiAssistantSettingChange = (key, value) => {
    saveAiAssistantSettings({ [key]: value });
    setAiAssistantSettings(prev => ({
      ...prev,
      settings: {
        ...prev.settings,
        [key]: value
      }
    }));
    window.dispatchEvent(new Event('storage'));
  };

  const handleGeneralSettingChange = (changes) => {
    const updatedGeneral = saveGeneralSettings(changes);
    setGeneralSettings(updatedGeneral);
    setSettings(prev => ({
      ...prev,
      general: updatedGeneral
    }));
    window.dispatchEvent(new Event('storage'));
  };

  const handleSwitchUser = (userId) => {
    setActiveUser(userId);
    setUsersState(getUsers());
  };

  const handleAccentSelect = (accentId) => {
    if (accentId === generalSettings.accent) {
      return;
    }
    handleGeneralSettingChange({ accent: accentId });
  };

  const handleFontSelect = (fontId) => {
    if (fontId === generalSettings.font) {
      return;
    }
    handleGeneralSettingChange({ font: fontId });
  };

  const renderAppSettings = (app) => {
    switch (app.id) {
      case 'clock':
        return (
          <div className="space-y-4">
            <div>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={getAppSetting('clock', 'format24h', false)}
                  onChange={(e) => handleSettingChange('clock', 'format24h', e.target.checked)}
                  className="rounded"
                />
                <span>24-hour format</span>
              </label>
            </div>
            <div>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={getAppSetting('clock', 'showSeconds', true)}
                  onChange={(e) => handleSettingChange('clock', 'showSeconds', e.target.checked)}
                  className="rounded"
                />
                <span>Show seconds</span>
              </label>
            </div>
            <div>
              <label className="block mb-2">Font Size</label>
              <select
                value={getAppSetting('clock', 'fontSize', 'large')}
                onChange={(e) => handleSettingChange('clock', 'fontSize', e.target.value)}
                className="bg-gray-700 text-white rounded px-3 py-2 w-full"
              >
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
              </select>
            </div>
          </div>
        );

      case 'date':
        return (
          <div className="space-y-4">
            <div>
              <label className="block mb-2">Date Format</label>
              <select
                value={getAppSetting('date', 'format', 'long')}
                onChange={(e) => handleSettingChange('date', 'format', e.target.value)}
                className="bg-gray-700 text-white rounded px-3 py-2 w-full"
              >
                <option value="short">Short</option>
                <option value="medium">Medium</option>
                <option value="long">Long</option>
              </select>
            </div>
            <div>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={getAppSetting('date', 'showYear', true)}
                  onChange={(e) => handleSettingChange('date', 'showYear', e.target.checked)}
                  className="rounded"
                />
                <span>Show year</span>
              </label>
            </div>
          </div>
        );

      case 'weather':
        return (
          <div className="space-y-4">
            <div>
              <label className="block mb-2">Location</label>
              <input
                type="text"
                placeholder="Enter city name"
                value={getAppSetting('weather', 'location', '')}
                onChange={(e) => handleSettingChange('weather', 'location', e.target.value)}
                className="bg-gray-700 text-white rounded px-3 py-2 w-full"
              />
            </div>
            <div>
              <label className="block mb-2">Temperature Units</label>
              <select
                value={getAppSetting('weather', 'units', 'fahrenheit')}
                onChange={(e) => handleSettingChange('weather', 'units', e.target.value)}
                className="bg-gray-700 text-white rounded px-3 py-2 w-full"
              >
                <option value="fahrenheit">Fahrenheit</option>
                <option value="celsius">Celsius</option>
              </select>
            </div>
            <div>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={getAppSetting('weather', 'showDetails', true)}
                  onChange={(e) => handleSettingChange('weather', 'showDetails', e.target.checked)}
                  className="rounded"
                />
                <span>Show weather details</span>
              </label>
            </div>
          </div>
        );

      case 'news': {
        const NEWS_CHANNELS = [
          { id: 'bbc',           label: 'BBC',            desc: 'BBC World News' },
          { id: 'aljazeera',     label: 'Al Jazeera',     desc: 'Al Jazeera English' },
          { id: 'trt',           label: 'TRT World',      desc: 'TRT World News' },
          { id: 'turkishminute', label: 'Turkish Minute', desc: 'Independent Turkish news' }
        ];
        const activeSources = getAppSetting('news', 'sources', ['bbc', 'trt']);
        const toggleSource = (id) => {
          const next = activeSources.includes(id)
            ? activeSources.filter(s => s !== id)
            : [...activeSources, id];
          // Always keep at least one source selected
          if (next.length === 0) return;
          handleSettingChange('news', 'sources', next);
        };

        return (
          <div className="space-y-5">
            <div>
              <label className="block mb-3 font-medium">News Channels</label>
              <div className="space-y-2">
                {NEWS_CHANNELS.map(ch => {
                  const isOn = activeSources.includes(ch.id);
                  return (
                    <button
                      key={ch.id}
                      onClick={() => toggleSource(ch.id)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border transition-all duration-150 text-left ${
                        isOn
                          ? 'bg-white/10 border-white/30 text-white'
                          : 'bg-transparent border-white/10 text-white/40 hover:border-white/20 hover:text-white/60'
                      }`}
                    >
                      <div>
                        <div className="font-medium text-sm">{ch.label}</div>
                        <div className="text-xs opacity-60 mt-0.5">{ch.desc}</div>
                      </div>
                      <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                        isOn ? 'bg-white/90 border-white' : 'border-white/25'
                      }`}>
                        {isOn && (
                          <svg className="w-2.5 h-2.5 text-black" fill="currentColor" viewBox="0 0 12 12">
                            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
              <p className="text-white/30 text-xs mt-2">
                {activeSources.length} source{activeSources.length !== 1 ? 's' : ''} selected · articles merged newest-first
              </p>
            </div>

            <div>
              <label className="block mb-2">Max Articles</label>
              <select
                value={getAppSetting('news', 'maxItems', 8)}
                onChange={(e) => handleSettingChange('news', 'maxItems', parseInt(e.target.value))}
                className="bg-gray-700 text-white rounded px-3 py-2 w-full"
              >
                <option value={5}>5</option>
                <option value={8}>8</option>
                <option value={12}>12</option>
              </select>
            </div>

            <div>
              <label className="block mb-2">Refresh Interval</label>
              <select
                value={getAppSetting('news', 'refreshInterval', 300000)}
                onChange={(e) => handleSettingChange('news', 'refreshInterval', parseInt(e.target.value))}
                className="bg-gray-700 text-white rounded px-3 py-2 w-full"
              >
                <option value={60000}>1 minute</option>
                <option value={300000}>5 minutes</option>
                <option value={600000}>10 minutes</option>
                <option value={1800000}>30 minutes</option>
              </select>
            </div>
          </div>
        );
      }

      case 'spotify': {
        const username = getAppSetting('spotify', 'username', '');
        const clientId = getAppSetting('spotify', 'clientId', '');
        const clientSecret = getAppSetting('spotify', 'clientSecret', '');
        const lastAuthenticatedAt = getAppSetting('spotify', 'lastAuthenticatedAt', '');
        const tokenExpiresAt = getAppSetting('spotify', 'tokenExpiresAt', '');
        const formattedLastAuth = lastAuthenticatedAt ? new Date(lastAuthenticatedAt).toLocaleString() : '';
        const formattedExpiry = tokenExpiresAt ? new Date(tokenExpiresAt).toLocaleString() : '';
        const isAuthenticating = spotifyAuthState.status === 'pending';
        const statusClass =
          spotifyAuthState.status === 'error'
            ? 'text-red-300'
            : spotifyAuthState.status === 'success'
              ? 'text-emerald-300'
              : 'text-sky-300';

        return (
          <div className="space-y-5">
            <div className="text-sm text-gray-300 leading-relaxed">
              Provide your Spotify Developer credentials, then click Authenticate to open Spotify and
              finish linking your account.
            </div>

            <div className="space-y-4">
              <div>
                <label className="block mb-2">Spotify Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => handleSettingChange('spotify', 'username', e.target.value)}
                  placeholder="spotify-user"
                  autoComplete="username"
                  className="bg-gray-700 text-white rounded px-3 py-2 w-full"
                />
              </div>

              <div>
                <label className="block mb-2">Client ID</label>
                <input
                  type="text"
                  value={clientId}
                  onChange={(e) => handleSettingChange('spotify', 'clientId', e.target.value)}
                  placeholder="0123456789abcdef"
                  autoComplete="off"
                  className="bg-gray-700 text-white rounded px-3 py-2 w-full font-mono"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Use the Client ID from your Spotify developer app. The redirect URI should be set to
                  <code className="ml-1">/api/spotify/callback</code>.
                </p>
              </div>

              <div>
                <label className="block mb-2">Client Secret</label>
                <input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => handleSettingChange('spotify', 'clientSecret', e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="bg-gray-700 text-white rounded px-3 py-2 w-full font-mono"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={handleSpotifyAuthenticate}
              disabled={isAuthenticating}
              className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isAuthenticating ? 'Authenticating…' : 'Authenticate with Spotify'}
            </button>

            {spotifyAuthState.message ? (
              <p className={`text-sm ${statusClass}`}>{spotifyAuthState.message}</p>
            ) : null}

            {formattedLastAuth || formattedExpiry ? (
              <div className="rounded-lg border border-gray-700/60 bg-gray-800/60 px-4 py-3 text-sm text-gray-200 space-y-1">
                {formattedLastAuth ? (
                  <div>
                    <span className="text-gray-400">Last authenticated:</span>{' '}
                    <span className="font-medium text-gray-100">{formattedLastAuth}</span>
                  </div>
                ) : null}
                {formattedExpiry ? (
                  <div>
                    <span className="text-gray-400">Token expires:</span>{' '}
                    <span className="font-medium text-gray-100">{formattedExpiry}</span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      }

      case 'handtracking': {
        const isEnabled = getAppSetting('handtracking', 'enabled', false);
        const brightness = getAppSetting('handtracking', 'brightness', 1);
        const contrast = getAppSetting('handtracking', 'contrast', 1);
        const detectionConfidence = getAppSetting('handtracking', 'minDetectionConfidence', 0.5);
        const trackingConfidence = getAppSetting('handtracking', 'minTrackingConfidence', 0.5);
        const preprocessingQuality = getAppSetting('handtracking', 'preprocessingQuality', 'medium');

        const getFillPercent = (value, min, max) =>
          Math.min(Math.max(((value - min) / (max - min)) * 100, 0), 100);

        const brightnessFill = getFillPercent(brightness, 0.5, 3);
        const contrastFill = getFillPercent(contrast, 0.5, 1.5);
        const detectionFill = getFillPercent(detectionConfidence, 0.1, 0.95);
        const trackingFill = getFillPercent(trackingConfidence, 0.1, 0.95);

        return (
          <div className="space-y-4">
            <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-4">
              <div className="flex items-center space-x-2 text-yellow-400">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <span className="font-medium">Camera Permission Required</span>
              </div>
              <p className="text-sm text-yellow-300 mt-2">
                This app requires access to your camera for hand tracking. Make sure to allow camera permissions when prompted.
              </p>
            </div>
            
            <div>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={(e) => handleSettingChange('handtracking', 'enabled', e.target.checked)}
                  className="rounded"
                />
                <span>Enable Hand Tracking</span>
              </label>
              <p className="text-sm text-gray-400 mt-1">
                Track your index finger to control a cursor on the mirror
              </p>
            </div>
            
            <div>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={getAppSetting('handtracking', 'showPreview', false)}
                  onChange={(e) => handleSettingChange('handtracking', 'showPreview', e.target.checked)}
                  className="rounded"
                  disabled={!isEnabled}
                />
                <span>Show Camera Preview</span>
              </label>
              <p className="text-sm text-gray-400 mt-1">
                Display camera feed with hand landmarks in the Hand Tracking app
              </p>
            </div>

            <div>
              <label className="block mb-2">Camera Position on Mirror</label>
              <select
                value={getAppSetting('handtracking', 'cameraPosition', 'top')}
                onChange={(e) => handleSettingChange('handtracking', 'cameraPosition', e.target.value)}
                className="bg-gray-700 text-white rounded px-3 py-2 w-full"
                disabled={!isEnabled}
              >
                {CAMERA_POSITION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-sm text-gray-400 mt-1">
                Rotate cursor movement to match where the camera is mounted on the mirror
              </p>
            </div>

            <div>
              <label className="block mb-2">Cursor Sensitivity</label>
              <select
                value={getAppSetting('handtracking', 'sensitivity', 1.0)}
                onChange={(e) => handleSettingChange('handtracking', 'sensitivity', parseFloat(e.target.value))}
                className="bg-gray-700 text-white rounded px-3 py-2 w-full"
                disabled={!isEnabled}
              >
                <option value={0.5}>Low</option>
                <option value={1.0}>Normal</option>
                <option value={1.5}>High</option>
                <option value={2.0}>Very High</option>
              </select>
              <p className="text-sm text-gray-400 mt-1">
                Adjust how responsive the cursor is to hand movements
              </p>
            </div>

            <div>
              <label className="block mb-2">Movement Smoothing</label>
              <select
                value={getAppSetting('handtracking', 'smoothing', 0.8)}
                onChange={(e) => handleSettingChange('handtracking', 'smoothing', parseFloat(e.target.value))}
                className="bg-gray-700 text-white rounded px-3 py-2 w-full"
                disabled={!isEnabled}
              >
                <option value={0.2}>Minimal</option>
                <option value={0.5}>Low</option>
                <option value={0.8}>Normal</option>
                <option value={0.9}>High</option>
              </select>
              <p className="text-sm text-gray-400 mt-1">
                Reduce cursor jitter with movement smoothing
              </p>
            </div>

            <div>
              <label className="block mb-2">Preprocessing Quality</label>
              <select
                value={preprocessingQuality}
                onChange={(e) => handleSettingChange('handtracking', 'preprocessingQuality', e.target.value)}
                className="bg-gray-700 text-white rounded px-3 py-2 w-full"
                disabled={!isEnabled}
              >
                <option value="low">Low (fastest)</option>
                <option value="medium">Medium</option>
                <option value="full">Full (best detail)</option>
              </select>
              <p className="text-sm text-gray-400 mt-1">
                Lower quality reduces the resolution sent to MediaPipe for better performance on small devices.
              </p>
            </div>

            <div>
              <label className="block mb-2">
                Detection Confidence: {Math.round(detectionConfidence * 100)}%
              </label>
              <input
                type="range"
                min="0.1"
                max="0.95"
                step="0.01"
                value={detectionConfidence}
                onChange={(e) => handleSettingChange('handtracking', 'minDetectionConfidence', parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                disabled={!isEnabled}
                style={{
                  background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${detectionFill}%, #374151 ${detectionFill}%, #374151 100%)`
                }}
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>More false positives</span>
                <span>More selective</span>
              </div>
              <p className="text-sm text-gray-400 mt-1">
                Increase for more reliable detections or lower it to react faster in low light.
              </p>
            </div>

            <div>
              <label className="block mb-2">
                Tracking Confidence: {Math.round(trackingConfidence * 100)}%
              </label>
              <input
                type="range"
                min="0.1"
                max="0.95"
                step="0.01"
                value={trackingConfidence}
                onChange={(e) => handleSettingChange('handtracking', 'minTrackingConfidence', parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                disabled={!isEnabled}
                style={{
                  background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${trackingFill}%, #374151 ${trackingFill}%, #374151 100%)`
                }}
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>More responsive</span>
                <span>More stable</span>
              </div>
              <p className="text-sm text-gray-400 mt-1">
                Lower values help weaker CPUs keep up, while higher values prefer steadier tracking.
              </p>
            </div>

            <div>
              <label className="block mb-2">
                Brightness: {Math.round(brightness * 100)}%
              </label>
              <input
                type="range"
                min="0.5"
                max="3"
                step="0.05"
                value={brightness}
                onChange={(e) => handleSettingChange('handtracking', 'brightness', parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                disabled={!isEnabled}
                style={{
                  background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${brightnessFill}%, #374151 ${brightnessFill}%, #374151 100%)`
                }}
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>Darker</span>
                <span>Brighter</span>
              </div>
              <p className="text-sm text-gray-400 mt-1">
                Increase brightness to help the camera see more detail in low light
              </p>
            </div>

            <div>
              <label className="block mb-2">
                Contrast: {Math.round(contrast * 100)}%
              </label>
              <input
                type="range"
                min="0.5"
                max="1.5"
                step="0.05"
                value={contrast}
                onChange={(e) => handleSettingChange('handtracking', 'contrast', parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                disabled={!isEnabled}
                style={{
                  background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${contrastFill}%, #374151 ${contrastFill}%, #374151 100%)`
                }}
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>Softer</span>
                <span>Sharper</span>
              </div>
              <p className="text-sm text-gray-400 mt-1">
                Adjust contrast to make your hand stand out from the background
              </p>
            </div>

            <div>
              <label className="block mb-2">
                Pinch Sensitivity: {Math.round(getAppSetting('handtracking', 'pinchSensitivity', 0.2) * 100)}%
              </label>
              <input
                type="range"
                min="0.05"
                max="0.5"
                step="0.05"
                value={getAppSetting('handtracking', 'pinchSensitivity', 0.2)}
                onChange={(e) => handleSettingChange('handtracking', 'pinchSensitivity', parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                disabled={!isEnabled}
                style={{
                  background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${getAppSetting('handtracking', 'pinchSensitivity', 0.2) * 200}%, #374151 ${getAppSetting('handtracking', 'pinchSensitivity', 0.2) * 200}%, #374151 100%)`
                }}
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>Very Sensitive (5%)</span>
                <span>Less Sensitive (50%)</span>
              </div>
              <p className="text-sm text-gray-400 mt-1">
                Lower values = easier to trigger pinch, higher values = need tighter pinch
              </p>
            </div>
          </div>
        );
      }

      case 'gmail':
        return (
          <div className="space-y-4">
            <div>
              <label className="block mb-2">Emails to Display</label>
              <select
                value={getAppSetting('gmail', 'maxEmails', 5)}
                onChange={(e) => handleSettingChange('gmail', 'maxEmails', parseInt(e.target.value))}
                className="bg-gray-700 text-white rounded px-3 py-2 w-full"
              >
                <option value={3}>3</option>
                <option value={5}>5</option>
                <option value={10}>10</option>
              </select>
            </div>
            <div>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={getAppSetting('gmail', 'showSnippets', true)}
                  onChange={(e) => handleSettingChange('gmail', 'showSnippets', e.target.checked)}
                  className="rounded"
                />
                <span>Show email snippets</span>
              </label>
            </div>
            <div>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={getAppSetting('gmail', 'showUnreadCount', true)}
                  onChange={(e) => handleSettingChange('gmail', 'showUnreadCount', e.target.checked)}
                  className="rounded"
                />
                <span>Show unread count badge</span>
              </label>
            </div>
            <p className="text-sm text-gray-400">
              Gmail connection is managed by the mirror backend. Enable the widget once your account is linked.
            </p>
          </div>
        );

      default:
        return <div className="text-gray-400">No settings available for this app.</div>;
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold">Smart Mirror Settings</h1>
          <Link
            to="/"
            className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition-colors"
          >
            Back to Mirror
          </Link>
        </div>

        <div className="mb-10">
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 shadow-lg shadow-black/20">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
              <div>
                <h2 className="text-xl font-semibold">General</h2>
                <p className="text-sm text-gray-400">
                  Dial in the vibe for every widget with color, type, and subtle chrome.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-gray-300">
                <span
                  className="px-3 py-1 rounded-full border border-white/10 bg-white/5"
                  style={{ color: selectedAccent.color }}
                >
                  {selectedAccent.name}
                </span>
                <span className="px-3 py-1 rounded-full border border-white/10 bg-white/5">
                  {selectedFont.name}
                </span>
              </div>
            </div>

            <div className="space-y-8">
              <div>
                <h3 className="text-lg font-medium mb-3">Accent Color</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                  {ACCENT_OPTIONS.map(accent => {
                    const isActive = generalSettings.accent === accent.id;
                    const isNone = accent.id === 'none';
                    return (
                      <button
                        key={accent.id}
                        type="button"
                        onClick={() => handleAccentSelect(accent.id)}
                        title={accent.description}
                        className={`group relative overflow-hidden rounded-lg border transition-all duration-200 text-left p-2.5 backdrop-blur-sm bg-white/5 ${
                          isActive ? 'shadow-md' : 'hover:border-white/20'
                        }`}
                        style={{
                          borderColor: isActive ? (isNone ? 'rgba(255,255,255,0.4)' : accent.color) : 'rgba(255, 255, 255, 0.1)',
                          boxShadow: isActive && !isNone ? `0 0 0 1px ${accent.color} inset, 0 8px 20px ${accent.color}44` : undefined
                        }}
                      >
                        {isNone ? (
                          <span className="flex items-center justify-center h-7 rounded-md mb-1.5 bg-white/5 border border-dashed border-white/20 text-gray-500 text-xs">
                            ✕
                          </span>
                        ) : (
                          <span
                            className="block h-7 rounded-md mb-1.5"
                            style={{ background: `linear-gradient(135deg, ${accent.color} 0%, ${accent.glow} 100%)` }}
                          />
                        )}
                        <div className="font-medium text-xs text-white truncate">{accent.name}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <h3 className="text-lg font-medium mb-3">Font Style</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {FONT_OPTIONS.map(font => {
                    const isActive = generalSettings.font === font.id;
                    return (
                      <button
                        key={font.id}
                        type="button"
                        onClick={() => handleFontSelect(font.id)}
                        className={`rounded-xl border px-4 py-4 text-left transition-all duration-300 bg-white/5 backdrop-blur-sm ${
                          isActive ? 'border-white/30 shadow-lg' : 'border-white/10 hover:border-white/20'
                        }`}
                        style={{
                          fontFamily: font.stack,
                          boxShadow: isActive ? '0 18px 30px rgba(0, 0, 0, 0.35), 0 0 25px var(--mirror-accent-soft)' : undefined
                        }}
                      >
                        <div className="text-sm font-semibold text-white">{font.name}</div>
                        <div className="text-xs text-gray-400">{font.description}</div>
                        <div className="mt-3 text-base text-white/90 tracking-wide">
                          The future is bright.
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <label className="flex items-start space-x-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                  <input
                    type="checkbox"
                    className="mt-1 rounded"
                    checked={generalSettings.widgetBorders}
                    onChange={(event) => handleGeneralSettingChange({ widgetBorders: event.target.checked })}
                  />
                  <span className="text-sm text-gray-200">
                    <span className="block font-medium text-white">Widget borders</span>
                    <span className="block text-xs text-gray-400 mt-1">
                      Outline every card with sleek edges for extra clarity.
                    </span>
                  </span>
                </label>
                <label className="flex items-start space-x-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                  <input
                    type="checkbox"
                    className="mt-1 rounded"
                    checked={generalSettings.widgetShadows}
                    onChange={(event) => handleGeneralSettingChange({ widgetShadows: event.target.checked })}
                  />
                  <span className="text-sm text-gray-200">
                    <span className="block font-medium text-white">Widget shadows</span>
                    <span className="block text-xs text-gray-400 mt-1">
                      Add a soft glow in your accent color beneath each widget.
                    </span>
                  </span>
                </label>
                <label className="flex items-start space-x-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                  <input
                    type="checkbox"
                    className="mt-1 rounded"
                    checked={generalSettings.widgetHoverHighlight}
                    onChange={(event) => handleGeneralSettingChange({ widgetHoverHighlight: event.target.checked })}
                  />
                  <span className="text-sm text-gray-200">
                    <span className="block font-medium text-white">Hover highlight</span>
                    <span className="block text-xs text-gray-400 mt-1">
                      Flash the widget border when the mouse or hand cursor floats over it.
                    </span>
                  </span>
                </label>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-4 space-y-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-medium text-white">Sleep timeout</h3>
                    <p className="text-xs text-gray-400 mt-1">
                      Fade the mirror to black after a period of inactivity and wake it with a fist-to-open gesture.
                    </p>
                  </div>
                  <label className="flex items-center space-x-2 text-sm text-gray-200">
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={Boolean(generalSettings.mirrorTimeoutEnabled)}
                      onChange={(event) => handleGeneralSettingChange({ mirrorTimeoutEnabled: event.target.checked })}
                    />
                    <span>Enable timeout</span>
                  </label>
                </div>
                <div>
                  <label className="block text-xs font-medium uppercase tracking-wide text-gray-400 mb-1">
                    Sleep after (minutes)
                  </label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    value={generalSettings.mirrorTimeoutMinutes ?? 5}
                    onChange={(event) => {
                      const parsedValue = Number(event.target.value);
                      const safeValue = Number.isFinite(parsedValue) ? Math.max(1, Math.round(parsedValue)) : 1;
                      handleGeneralSettingChange({ mirrorTimeoutMinutes: safeValue });
                    }}
                    disabled={!generalSettings.mirrorTimeoutEnabled}
                  />
                </div>
              </div>

              <div>
                <h3 className="text-lg font-medium mb-3">Language / Dil</h3>
                <div className="flex gap-3">
                  {LANGUAGES.map(lang => {
                    const isActive = (generalSettings.language || 'en') === lang.id;
                    return (
                      <button
                        key={lang.id}
                        type="button"
                        onClick={() => handleGeneralSettingChange({ language: lang.id })}
                        className={`flex-1 rounded-xl border px-4 py-3 text-left transition-all duration-200 bg-white/5 backdrop-blur-sm ${
                          isActive ? 'border-white/30 shadow-lg' : 'border-white/10 hover:border-white/20'
                        }`}
                        style={{
                          boxShadow: isActive ? '0 18px 30px rgba(0,0,0,0.35), 0 0 25px var(--mirror-accent-soft)' : undefined
                        }}
                      >
                        <div className="text-sm font-semibold text-white">{lang.nativeLabel}</div>
                        <div className="text-xs text-gray-400">{lang.label}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Users section ─────────────────────────────────────────────────── */}
        <div className="mb-10">
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 shadow-lg shadow-black/20">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-6">
              <div>
                <h2 className="text-xl font-semibold">Users</h2>
                <p className="text-sm text-gray-400">
                  Choose who is currently using the mirror.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-700/50 border border-gray-600/50 rounded-lg px-3 py-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="5" y="2" width="14" height="20" rx="2" />
                  <path d="M12 18h.01" />
                </svg>
                <span>Phone registration &amp; sync coming soon</span>
              </div>
            </div>

            {/* User chips + add button */}
            <div className="flex flex-wrap gap-3 items-center">
              {usersState.profiles.map(profile => {
                const isActive = profile.id === usersState.activeUserId;
                return (
                  <button
                    key={profile.id}
                    type="button"
                    onClick={() => handleSwitchUser(profile.id)}
                    className={`group flex items-center gap-3 rounded-xl border px-4 py-3 transition-all duration-200 text-left min-w-[140px] ${
                      isActive
                        ? 'border-[var(--mirror-accent-color,#38bdf8)] bg-[color-mix(in_srgb,var(--mirror-accent-color,#38bdf8)_12%,transparent)] shadow-md'
                        : 'border-gray-600 bg-gray-700/50 hover:border-gray-500 hover:bg-gray-700'
                    }`}
                  >
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 transition-colors ${
                        isActive
                          ? 'bg-[var(--mirror-accent-color,#38bdf8)] text-gray-900'
                          : 'bg-gray-600 text-gray-200 group-hover:bg-gray-500'
                      }`}
                    >
                      {profile.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className={`font-medium text-sm truncate ${isActive ? 'text-white' : 'text-gray-200'}`}>
                        {profile.name}
                      </div>
                      <div className="text-xs text-gray-400 truncate">
                        {profile.gmailConnected ? profile.gmailEmail || 'Gmail connected' : 'Gmail not connected'}
                      </div>
                    </div>
                    {isActive && (
                      <div className="ml-auto w-2 h-2 rounded-full bg-[var(--mirror-accent-color,#38bdf8)] flex-shrink-0" />
                    )}
                  </button>
                );
              })}

              {/* Add User placeholder — wired up when phone sign-in is ready */}
              <button
                type="button"
                disabled
                className="flex items-center gap-2 rounded-xl border border-dashed border-gray-500 bg-transparent px-4 py-3 text-sm text-gray-400 cursor-not-allowed opacity-60 min-w-[140px]"
                title="Users are added via the phone app"
              >
                <span className="w-9 h-9 rounded-full border border-dashed border-gray-500 flex items-center justify-center text-lg text-gray-400 flex-shrink-0">+</span>
                <span>Add User</span>
              </button>
            </div>

            <p className="mt-5 text-xs text-gray-500">
              Users are added when signing in through the phone app.
            </p>
          </div>
        </div>

        {/* ── AI Assistant section ───────────────────────────────────────────── */}
        <div className="mb-10">
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 shadow-lg shadow-black/20">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-6">
              <div>
                <h2 className="text-xl font-semibold">AI Assistant</h2>
                <p className="text-sm text-gray-400">
                  Configure the realtime voice assistant that responds when you say "Hey Mirror".
                </p>
              </div>
              <div className="flex items-center justify-between md:justify-end w-full md:w-auto">
                <div className="mr-4">
                  <h3 className="text-lg font-medium">Enable AI Assistant</h3>
                  <p className="text-sm text-gray-400 mt-1">
                    Toggle the voice assistant that listens for your custom hotword.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={aiAssistantSettings.enabled}
                    onChange={(event) => handleToggleAiAssistant(event.target.checked)}
                  />
                  <div className="w-11 h-6 bg-gray-600 rounded-full peer-focus:outline-none peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>
            </div>

            {!assistantSettings.apiKey && (
              <div className="bg-amber-500/10 border border-amber-500/20 text-amber-100 rounded-lg px-4 py-3 text-sm mb-6">
                Add your OpenAI API key to enable the realtime conversation experience.
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium mb-2">Voice (Realtime) Model</label>
                <select
                  value={assistantSettings.realtimeModel || REALTIME_MODELS[0].value}
                  onChange={(e) => handleAiAssistantSettingChange('realtimeModel', e.target.value)}
                  className="bg-gray-700 text-white rounded px-3 py-2 w-full"
                >
                  {REALTIME_MODELS.map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Chat (Text / Fallback) Model</label>
                <select
                  value={assistantSettings.chatModel || CHAT_MODELS[0].value}
                  onChange={(e) => handleAiAssistantSettingChange('chatModel', e.target.value)}
                  className="bg-gray-700 text-white rounded px-3 py-2 w-full"
                >
                  {CHAT_MODELS.map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Voice</label>
                <select
                  value={assistantSettings.voice || VOICE_OPTIONS[0].value}
                  onChange={(e) => handleAiAssistantSettingChange('voice', e.target.value)}
                  className="bg-gray-700 text-white rounded px-3 py-2 w-full"
                >
                  {VOICE_OPTIONS.map(voice => (
                    <option key={voice.value} value={voice.value}>
                      {voice.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-2">OpenAI API Key</label>
                <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-3 space-y-3 sm:space-y-0">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={assistantSettings.apiKey || ''}
                    onChange={(e) => handleAiAssistantSettingChange('apiKey', e.target.value)}
                    placeholder="sk-..."
                    className="flex-1 bg-gray-700 text-white rounded px-3 py-2"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(prev => !prev)}
                    className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded text-sm"
                  >
                    {showApiKey ? 'Hide' : 'Show'}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Stored locally in your browser and used only to connect directly to OpenAI for realtime conversations.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Assistant Name</label>
                <input
                  type="text"
                  value={assistantSettings.name ?? ''}
                  onChange={(event) => handleAiAssistantSettingChange('name', event.target.value)}
                  className="bg-gray-700 text-white rounded px-3 py-2 w-full"
                  placeholder="Mirror"
                  disabled={!aiAssistantSettings.enabled}
                />
                <p className="text-xs text-gray-400 mt-2">
                  The assistant listens for the phrase <span className="text-blue-300 font-semibold">"Hey {assistantSettings.name || 'Mirror'}"</span>.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">ElevenLabs API Key</label>
                <input
                  type="password"
                  value={assistantSettings.elevenLabsKey || ''}
                  onChange={(e) => handleAiAssistantSettingChange('elevenLabsKey', e.target.value)}
                  className="bg-gray-700 text-white rounded px-3 py-2 w-full"
                  placeholder="sk_..."
                  disabled={!aiAssistantSettings.enabled}
                />
                <p className="text-xs text-gray-500 mt-2">
                  Used for high-quality voice output. Leave blank to use browser speech synthesis as fallback.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">ElevenLabs Voice ID</label>
                <input
                  type="text"
                  value={assistantSettings.elevenLabsVoiceId || ''}
                  onChange={(e) => handleAiAssistantSettingChange('elevenLabsVoiceId', e.target.value)}
                  className="bg-gray-700 text-white rounded px-3 py-2 w-full"
                  placeholder="JBFqnCBsd6RMkjVDRZzb"
                  disabled={!aiAssistantSettings.enabled}
                />
                <p className="text-xs text-gray-500 mt-2">
                  Find voice IDs at <span className="text-blue-400">elevenlabs.io/voice-lab</span>. Default: George (British).
                </p>
              </div>
              <div className="md:col-span-2">
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={assistantSettings.showRawTranscripts || false}
                    onChange={(event) => handleAiAssistantSettingChange('showRawTranscripts', event.target.checked)}
                    className="rounded"
                    disabled={!aiAssistantSettings.enabled}
                  />
                  <span>Show raw speech-to-text output for debugging</span>
                </label>
                <p className="text-xs text-gray-400 mt-1">
                  Displays the live transcript so you can confirm the hotword is being detected.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* App List */}
        <div className="lg:col-span-1">
          <h2 className="text-xl font-semibold mb-4">Apps</h2>
            <div className="space-y-2">
              {apps.map(app => (
                <div 
                  key={app.id}
                  className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                    selectedApp?.id === app.id 
                      ? 'bg-blue-600 border-blue-500' 
                      : 'bg-gray-800 border-gray-700 hover:bg-gray-750'
                  }`}
                  onClick={() => setSelectedApp(app)}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium">{app.name}</h3>
                      <p className="text-sm text-gray-400">{app.description}</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isAppEnabled(app.id)}
                        onChange={(e) => {
                          e.stopPropagation();
                          handleToggleApp(app.id, e.target.checked);
                        }}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* App Settings */}
          <div className="lg:col-span-2">
            {selectedApp ? (
              <div>
                <h2 className="text-xl font-semibold mb-4">{selectedApp.name} Settings</h2>
                <div className="bg-gray-800 p-6 rounded-lg">
                  {isAppEnabled(selectedApp.id) ? (
                    renderAppSettings(selectedApp)
                  ) : (
                    <div className="text-center text-gray-400 py-8">
                      <div className="text-4xl mb-4">📱</div>
                      <p>Enable this app to configure its settings</p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-gray-800 p-6 rounded-lg">
                <div className="text-center text-gray-400 py-8">
                  <div className="text-4xl mb-4">⚙️</div>
                  <p>Select an app to configure its settings</p>
                </div>
              </div>
            )}
          </div>
        </div>


      </div>
    </div>
  );
};

export default Settings;
