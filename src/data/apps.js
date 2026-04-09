export const apps = [
  {
    id: 'datetime',
    name: 'Date & Time',
    description: 'Combined date and time display',
    componentPath: 'DateTimeApp',
    enabled: true,
    defaultPosition: { x: 50, y: 50 },
    defaultSize: { width: 340, height: 160 },
    settings: {}
  },
  {
    id: 'weather',
    name: 'Weather',
    description: 'Current weather conditions',
    componentPath: 'WeatherApp',
    enabled: true,
    defaultPosition: { x: 400, y: 50 },
    defaultSize: { width: 300, height: 320 },
    settings: {
      location: 'Istanbul',
      units: 'celsius', // 'celsius', 'fahrenheit'
      showDetails: true
    }
  },
  {
    id: 'news',
    name: 'News',
    description: 'Latest news headlines',
    componentPath: 'NewsApp',
    enabled: true,
    defaultPosition: { x: 50, y: 400 },
    defaultSize: { width: 400, height: 250 },
    settings: {
      maxItems: 8,
      refreshInterval: 300000, // 5 minutes
      sources: ['bbc', 'trt']  // selected news channels (bbc | aljazeera | trt | turkishminute)
    }
  },
  {
    id: 'spotify',
    name: 'Spotify',
    description: 'Spin your Spotify playback like a record player',
    componentPath: 'SpotifyApp',
    enabled: false,
    defaultPosition: { x: 620, y: 320 },
    defaultSize: { width: 240, height: 340 },
    settings: {
      username: '',
      clientId: '',
      clientSecret: '',
      lastAuthenticatedAt: '',
      tokenExpiresAt: ''
    }
  },
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Recent emails and unread count from your Gmail inbox',
    componentPath: 'GmailApp',
    enabled: false,
    defaultPosition: { x: 750, y: 50 },
    defaultSize: { width: 380, height: 320 },
    settings: {
      maxEmails: 5,        // Number of emails to display (3, 5, 10)
      showSnippets: true,  // Show email preview snippets
      showUnreadCount: true // Show unread count badge
    }
  },
  {
    id: 'handtracking',
    name: 'Hand Tracking',
    description: 'Camera-based hand tracking with cursor control',
    componentPath: 'HandTrackingApp',
    enabled: false,
    isBackgroundService: true, // This app runs in background, not displayed as widget
    defaultPosition: { x: 800, y: 50 },
    defaultSize: { width: 350, height: 300 },
    settings: {
      enabled: false,
      showPreview: false,
      sensitivity: 1.0,
      smoothing: 0.8,
      brightness: 1,
      contrast: 1,
      pinchSensitivity: 0.2, // Default 20% (0.0-1.0 range)
      cameraPosition: 'top',
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
      preprocessingQuality: 'medium'
    }
  }
];

export const getEnabledApps = () => {
  const settings = JSON.parse(localStorage.getItem('smartMirrorSettings') || '{}');
  return apps.filter(app => settings[app.id]?.enabled !== false);
};

export const getAppSettings = (appId) => {
  const settings = JSON.parse(localStorage.getItem('smartMirrorSettings') || '{}');
  const app = apps.find(a => a.id === appId);
  const defaults = app?.settings || {};
  const stored = settings[appId]?.settings || {};

  // Merge stored settings over defaults, but don't let an empty string overwrite
  // a non-empty default. This prevents old localStorage '' values from wiping new
  // defaults (e.g. location: 'Istanbul' should not be overridden by a stale '').
  const merged = { ...defaults };
  for (const key of Object.keys(stored)) {
    const storedVal = stored[key];
    const defaultVal = defaults[key];
    if (storedVal === '' && defaultVal !== '' && defaultVal !== undefined) {
      // Stored is empty but default is meaningful — keep the default
      continue;
    }
    merged[key] = storedVal;
  }
  return merged;
};

export const saveAppSettings = (appId, newSettings) => {
  const settings = JSON.parse(localStorage.getItem('smartMirrorSettings') || '{}');
  if (!settings[appId]) {
    settings[appId] = {};
  }
  settings[appId].settings = { ...settings[appId].settings, ...newSettings };
  localStorage.setItem('smartMirrorSettings', JSON.stringify(settings));
};

export const toggleAppEnabled = (appId, enabled) => {
  const settings = JSON.parse(localStorage.getItem('smartMirrorSettings') || '{}');
  if (!settings[appId]) {
    settings[appId] = {};
  }
  settings[appId].enabled = enabled;
  localStorage.setItem('smartMirrorSettings', JSON.stringify(settings));
};
