const STORAGE_KEY = 'smartMirrorSettings';

export const ACCENT_OPTIONS = [
  {
    id: 'none',
    name: 'None',
    description: 'No accent color',
    color: '#6b7280',
    glow: '#9ca3af'
  },
  {
    id: 'lunar-tide',
    name: 'Lunar Tide',
    description: 'Cool cosmic blue',
    color: '#38bdf8',
    glow: '#7dd3fc'
  },
  {
    id: 'midnight-mirage',
    name: 'Midnight Mirage',
    description: 'Electric ultraviolet',
    color: '#7c3aed',
    glow: '#c4b5fd'
  },
  {
    id: 'solar-ember',
    name: 'Solar Ember',
    description: 'Molten orange flash',
    color: '#f97316',
    glow: '#fb923c'
  },
  {
    id: 'neon-canopy',
    name: 'Neon Canopy',
    description: 'Lush neon green',
    color: '#34d399',
    glow: '#6ee7b7'
  },
  {
    id: 'bubblegum-pop',
    name: 'Bubblegum Pop',
    description: 'Playful hot pink',
    color: '#f472b6',
    glow: '#f9a8d4'
  },
  {
    id: 'crimson-comet',
    name: 'Crimson Comet',
    description: 'Radiant scarlet',
    color: '#f87171',
    glow: '#fca5a5'
  }
];

export const FONT_OPTIONS = [
  {
    id: 'galactic-groove',
    name: 'Galactic Groove',
    description: 'Rounded futurist sans',
    stack: "'DM Sans', 'Inter', 'Segoe UI', sans-serif"
  },
  {
    id: 'orbit-script',
    name: 'Orbit Script',
    description: 'Geometric techno vibe',
    stack: "'Orbitron', 'Space Grotesk', 'Inter', sans-serif"
  },
  {
    id: 'stellar-serif',
    name: 'Stellar Serif',
    description: 'Elegant editorial flair',
    stack: "'Playfair Display', 'Georgia', 'Times New Roman', serif"
  },
  {
    id: 'cosmic-forms',
    name: 'Cosmic Forms',
    description: 'Bold space-age curves',
    stack: "'Space Grotesk', 'Inter', 'Segoe UI', sans-serif"
  }
];

const DEFAULT_SETTINGS = {
  accent: ACCENT_OPTIONS[0].id,
  font: FONT_OPTIONS[0].id,
  language: 'en',
  widgetBorders: true,
  widgetShadows: true,
  widgetHoverHighlight: true,
  mirrorTimeoutEnabled: false,
  mirrorTimeoutMinutes: 5
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

const ensureGeneral = (settings) => {
  const general = {
    ...DEFAULT_SETTINGS,
    ...(settings.general || {})
  };

  general.mirrorTimeoutEnabled = Boolean(general.mirrorTimeoutEnabled);

  const minutes = Number(general.mirrorTimeoutMinutes);
  if (Number.isFinite(minutes) && minutes > 0) {
    general.mirrorTimeoutMinutes = Math.max(1, Math.round(minutes));
  } else {
    general.mirrorTimeoutMinutes = DEFAULT_SETTINGS.mirrorTimeoutMinutes;
  }

  return {
    ...settings,
    general
  };
};

export const getGeneralSettings = () => {
  const settings = ensureGeneral(readSettings());
  return settings.general;
};

export const saveGeneralSettings = (partialSettings, options = {}) => {
  const settings = ensureGeneral(readSettings());
  settings.general = {
    ...settings.general,
    ...partialSettings
  };
  const sanitizedSettings = ensureGeneral(settings);
  writeSettings(sanitizedSettings);
  if (typeof window !== 'undefined') {
    if (!options.silent) {
      window.dispatchEvent(new CustomEvent('smartMirror:generalSettingsChanged', {
        detail: { ...sanitizedSettings.general }
      }));
    }

    if (!options.skipStorageEvent) {
      window.dispatchEvent(new Event('storage'));
    }
  }
  return sanitizedSettings.general;
};

export const getAccentOption = (id) => {
  return ACCENT_OPTIONS.find(option => option.id === id) || ACCENT_OPTIONS[0];
};

export const getFontOption = (id) => {
  return FONT_OPTIONS.find(option => option.id === id) || FONT_OPTIONS[0];
};
