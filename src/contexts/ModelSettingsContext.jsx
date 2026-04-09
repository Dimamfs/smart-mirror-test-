import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'modelSettings';
const SMART_MIRROR_STORAGE_KEY = 'smartMirrorSettings';
const HAND_TRACKING_APP_ID = 'handtracking';

const DEFAULT_SETTINGS = {
  sizeScaler: 3.2,
  lineThickness: 6,
  tesseractBrightness: 1,
  glowEnabled: true,
  cameraPosition: 'top',
  sensitivity: 1,
  smoothing: 0.8,
  pinchSensitivity: 0.2,
  brightness: 1,
  contrast: 1,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5,
  preprocessingQuality: 'medium',
};

const MIRROR_SYNC_KEYS = [
  'cameraPosition',
  'sensitivity',
  'smoothing',
  'pinchSensitivity',
  'brightness',
  'contrast',
  'minDetectionConfidence',
  'minTrackingConfidence',
  'preprocessingQuality',
];

const ModelSettingsContext = createContext({
  settings: DEFAULT_SETTINGS,
  updateSettings: () => {},
});

const readStoredSettings = () => {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_SETTINGS };
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const modelSettingsRaw = stored ? JSON.parse(stored) : {};
    const modelSettings = { ...modelSettingsRaw };
    let legacyTesseractBrightness;

    if (
      typeof modelSettings.tesseractBrightness === 'undefined' &&
      typeof modelSettings.brightness === 'number'
    ) {
      legacyTesseractBrightness = modelSettings.brightness;
      delete modelSettings.brightness;
    }

    const smartMirrorRaw = window.localStorage.getItem(SMART_MIRROR_STORAGE_KEY);
    const smartMirrorSettings = smartMirrorRaw ? JSON.parse(smartMirrorRaw) : {};
    const handTrackingSettings =
      smartMirrorSettings?.[HAND_TRACKING_APP_ID]?.settings ?? {};

    const combined = {
      ...DEFAULT_SETTINGS,
      ...handTrackingSettings,
      ...modelSettings,
    };

    if (typeof legacyTesseractBrightness === 'number') {
      combined.tesseractBrightness = legacyTesseractBrightness;
    }

    return combined;
  } catch (error) {
    console.warn('Unable to read stored model settings', error);
    return { ...DEFAULT_SETTINGS };
  }
};

const persistToSmartMirror = (settings) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const raw = window.localStorage.getItem(SMART_MIRROR_STORAGE_KEY);
    const smartMirrorSettings = raw ? JSON.parse(raw) : {};
    const existingAppSettings = smartMirrorSettings[HAND_TRACKING_APP_ID] ?? {};
    const mirroredSettings = { ...existingAppSettings.settings };

    MIRROR_SYNC_KEYS.forEach((key) => {
      if (key in settings) {
        mirroredSettings[key] = settings[key];
      }
    });

    smartMirrorSettings[HAND_TRACKING_APP_ID] = {
      ...existingAppSettings,
      settings: mirroredSettings,
    };

    window.localStorage.setItem(
      SMART_MIRROR_STORAGE_KEY,
      JSON.stringify(smartMirrorSettings),
    );
  } catch (error) {
    console.warn('Unable to sync model settings with smart mirror settings', error);
  }
};

export const ModelSettingsProvider = ({ children }) => {
  const [settings, setSettings] = useState(() => readStoredSettings());

  useEffect(() => {
    const handleStorage = (event) => {
      if (
        event.key &&
        event.key !== STORAGE_KEY &&
        event.key !== SMART_MIRROR_STORAGE_KEY
      ) {
        return;
      }

      setSettings(readStoredSettings());
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const updateSettings = (partial) => {
    setSettings((prev) => {
      const next = {
        ...prev,
        ...partial,
      };

      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch (error) {
          console.warn('Unable to persist model settings', error);
        }
      }

      persistToSmartMirror(next);

      return next;
    });
  };

  const value = useMemo(() => ({ settings, updateSettings }), [settings]);

  return (
    <ModelSettingsContext.Provider value={value}>
      {children}
    </ModelSettingsContext.Provider>
  );
};

export const useModelSettings = () => useContext(ModelSettingsContext);

export const useModelSetting = (key) => {
  const { settings, updateSettings } = useModelSettings();
  return [settings[key], (value) => updateSettings({ [key]: value })];
};

export default ModelSettingsContext;
