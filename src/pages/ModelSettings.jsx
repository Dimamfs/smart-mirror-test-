import React from 'react';
import { Link } from 'react-router-dom';
import { useModelSettings } from '../contexts/ModelSettingsContext';
import { CAMERA_POSITION_OPTIONS } from '../utils/handTracking';

const RangeControl = ({
  id,
  label,
  min,
  max,
  step,
  value,
  onChange,
  suffix = '',
  formatValue,
  description,
}) => {
  const numericValue = Number.isFinite(value) ? value : min;
  const decimals = step < 1 ? 2 : 0;
  const displayValue = formatValue
    ? formatValue(numericValue)
    : `${numericValue.toFixed(decimals)}${suffix}`;

  return (
    <label htmlFor={id} className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-sm font-medium text-slate-200">
        <span>{label}</span>
        <span className="font-semibold text-white">{displayValue}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={numericValue}
        onChange={onChange}
        className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-700 accent-cyan-400"
      />
      {description ? (
        <span className="text-xs text-slate-400">{description}</span>
      ) : null}
    </label>
  );
};

const ModelSettings = () => {
  const { settings, updateSettings } = useModelSettings();

  const handleRangeChange = (key) => (event) => {
    updateSettings({ [key]: parseFloat(event.target.value) });
  };

  const handleGlowChange = (event) => {
    updateSettings({ glowEnabled: event.target.checked });
  };

  const handleSelectChange = (key) => (event) => {
    updateSettings({ [key]: event.target.value });
  };

  const cameraPosition = settings.cameraPosition || 'top';
  const preprocessingQuality = settings.preprocessingQuality || 'medium';

  return (
    <div className="min-h-screen w-full bg-black text-white">
      <div className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-12">
        <header className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold tracking-tight">Model Controls</h1>
            <Link
              to="/model"
              className="rounded-full border border-cyan-400/40 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-200 transition hover:bg-cyan-400/20"
            >
              Back to Model
            </Link>
          </div>
          <p className="max-w-2xl text-sm text-slate-300">
            Adjust how the tesseract renders when interacting with your hand. All settings are saved automatically and
            applied instantly to the /model page.
          </p>
        </header>

        <section className="space-y-6 rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
          <h2 className="text-xl font-semibold text-white">Interaction</h2>
          <div className="space-y-6">
            <RangeControl
              id="sizeScaler"
              label="Hand size multiplier"
              min={1}
              max={8}
              step={0.1}
              value={settings.sizeScaler}
              onChange={handleRangeChange('sizeScaler')}
              suffix="×"
            />
            <RangeControl
              id="sensitivity"
              label="Hand movement sensitivity"
              min={0.5}
              max={2}
              step={0.1}
              value={settings.sensitivity ?? 1}
              onChange={handleRangeChange('sensitivity')}
              formatValue={(val) => `${val.toFixed(1)}×`}
              description="Increase to exaggerate movement or reduce to keep the tesseract steadier."
            />
            <RangeControl
              id="smoothing"
              label="Motion smoothing"
              min={0}
              max={0.95}
              step={0.05}
              value={settings.smoothing ?? 0.8}
              onChange={handleRangeChange('smoothing')}
              formatValue={(val) => `${Math.round(val * 100)}%`}
              description="Higher smoothing softens jitter but adds a touch of lag."
            />
          </div>
        </section>

        <section className="space-y-6 rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
          <h2 className="text-xl font-semibold text-white">Appearance</h2>
          <div className="space-y-6">
            <RangeControl
              id="lineThickness"
              label="Line thickness"
              min={1}
              max={12}
              step={0.5}
              value={settings.lineThickness}
              onChange={handleRangeChange('lineThickness')}
              suffix="px"
            />
            <RangeControl
              id="tesseractBrightness"
              label="Tesseract brightness"
              min={0.3}
              max={3}
              step={0.05}
              value={settings.tesseractBrightness ?? 1}
              onChange={handleRangeChange('tesseractBrightness')}
              suffix="×"
              description="Fine-tune glow intensity independent from the camera exposure."
            />
            <label className="flex items-center gap-3 text-sm font-medium text-slate-200">
              <input
                type="checkbox"
                checked={settings.glowEnabled}
                onChange={handleGlowChange}
                className="h-4 w-4 rounded border border-slate-600 bg-black text-cyan-400 focus:ring-0"
              />
              Enable tesseract glow
            </label>
          </div>
        </section>

        <section className="space-y-6 rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
          <h2 className="text-xl font-semibold text-white">Camera &amp; Tracking</h2>
          <div className="space-y-6">
            <div className="flex flex-col gap-2">
              <label htmlFor="cameraPosition" className="text-sm font-medium text-slate-200">
                Camera position on mirror
              </label>
              <select
                id="cameraPosition"
                value={cameraPosition}
                onChange={handleSelectChange('cameraPosition')}
                className="rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white shadow-sm focus:border-cyan-400 focus:outline-none"
              >
                {CAMERA_POSITION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-400">
                Mirrors the same orientation choices available on the smart mirror hand tracking service.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="preprocessingQuality" className="text-sm font-medium text-slate-200">
                Hand tracking quality preset
              </label>
              <select
                id="preprocessingQuality"
                value={preprocessingQuality}
                onChange={handleSelectChange('preprocessingQuality')}
                className="rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white shadow-sm focus:border-cyan-400 focus:outline-none"
              >
                <option value="low">Low (fastest)</option>
                <option value="medium">Medium</option>
                <option value="full">Full (best detail)</option>
              </select>
              <p className="text-xs text-slate-400">
                Matches the MediaPipe pipeline used by the smart mirror hand tracking app.
              </p>
            </div>

            <RangeControl
              id="minDetectionConfidence"
              label="Detection confidence"
              min={0.1}
              max={0.95}
              step={0.01}
              value={settings.minDetectionConfidence ?? 0.5}
              onChange={handleRangeChange('minDetectionConfidence')}
              formatValue={(val) => `${Math.round(val * 100)}%`}
              description="Raise for stricter detections or lower to react more quickly in tough lighting."
            />

            <RangeControl
              id="minTrackingConfidence"
              label="Tracking confidence"
              min={0.1}
              max={0.95}
              step={0.01}
              value={settings.minTrackingConfidence ?? 0.5}
              onChange={handleRangeChange('minTrackingConfidence')}
              formatValue={(val) => `${Math.round(val * 100)}%`}
              description="Higher values prefer stability, while lower values keep older hardware responsive."
            />

            <RangeControl
              id="brightness"
              label="Camera brightness"
              min={0.5}
              max={3}
              step={0.05}
              value={settings.brightness ?? 1}
              onChange={handleRangeChange('brightness')}
              formatValue={(val) => `${Math.round(val * 100)}%`}
              description="Applies the same exposure boost used by the smart mirror preview."
            />

            <RangeControl
              id="contrast"
              label="Camera contrast"
              min={0.5}
              max={1.5}
              step={0.05}
              value={settings.contrast ?? 1}
              onChange={handleRangeChange('contrast')}
              formatValue={(val) => `${Math.round(val * 100)}%`}
              description="Increase to make your hand pop against the background."
            />

            <RangeControl
              id="pinchSensitivity"
              label="Pinch sensitivity"
              min={0.05}
              max={0.5}
              step={0.05}
              value={settings.pinchSensitivity ?? 0.2}
              onChange={handleRangeChange('pinchSensitivity')}
              formatValue={(val) => `${Math.round(val * 100)}%`}
              description="Lower thresholds trigger pinches sooner, just like on the smart mirror."
            />
          </div>
        </section>
      </div>
    </div>
  );
};

export default ModelSettings;
