const STORAGE_KEY = 'smartMirrorSettings';

const DEFAULT_SETTINGS = {
  enabled: false,
  settings: {
    name: 'Mirror',
    showRawTranscripts: false,
    apiKey: '',
    model: 'gpt-4o-mini-realtime-preview',
    voice: 'alloy'
  }
};

const readSettings = () => {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
  } catch (error) {
    console.warn('Unable to read smart mirror settings from storage', error);
    return {};
  }
};

const writeSettings = (settings) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
};

const ensureAssistant = (settings) => {
  if (!settings.aiAssistant) {
    settings.aiAssistant = {
      ...DEFAULT_SETTINGS,
      settings: { ...DEFAULT_SETTINGS.settings }
    };
  } else {
    settings.aiAssistant = {
      enabled: settings.aiAssistant.enabled ?? DEFAULT_SETTINGS.enabled,
      settings: {
        ...DEFAULT_SETTINGS.settings,
        ...(settings.aiAssistant.settings || {})
      }
    };
  }
  return settings;
};

export const getAiAssistantSettings = () => {
  const settings = ensureAssistant(readSettings());
  return settings.aiAssistant;
};

export const setAiAssistantEnabled = (enabled) => {
  const settings = ensureAssistant(readSettings());
  settings.aiAssistant.enabled = enabled;
  writeSettings(settings);
};

export const saveAiAssistantSettings = (newSettings) => {
  const settings = ensureAssistant(readSettings());
  settings.aiAssistant.settings = {
    ...settings.aiAssistant.settings,
    ...newSettings
  };
  writeSettings(settings);
};

export const DEFAULT_AI_ASSISTANT_SETTINGS = DEFAULT_SETTINGS;
