import { useState, useEffect, useRef } from 'react';
import { getAppSettings } from '../data/apps';
import useResponsiveFontScale from '../hooks/useResponsiveFontScale';
import { useLanguage } from '../contexts/LanguageContext';

// ── Weather code helpers ───────────────────────────────────────────────────

const WEATHER_ICONS = {
  0: '☀',  1: '🌤', 2: '⛅', 3: '☁',
  45: '🌫', 48: '🌫',
  51: '🌦', 53: '🌦', 55: '🌦',
  56: '🌧', 57: '🌧',
  61: '🌧', 63: '🌧', 65: '🌧',
  66: '🌧', 67: '🌧',
  71: '❄',  73: '❄',  75: '❄',  77: '❄',
  80: '🌧', 81: '🌧', 82: '🌧',
  85: '🌨', 86: '🌨',
  95: '⛈',  96: '⛈',  99: '⛈'
};

const weatherIcon = (code) => WEATHER_ICONS[code] ?? '—';

// ── Component ──────────────────────────────────────────────────────────────

const WeatherApp = ({ appId = 'weather' }) => {
  const [weatherData, setWeatherData] = useState(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');
  const [settings, setSettings]       = useState(getAppSettings(appId));
  const containerRef                  = useRef(null);
  const { t }                         = useLanguage();

  const weatherDesc = (code) => t.weatherDesc[code] ?? '';
  const dayName = (dateStr) => {
    const d = new Date(dateStr + 'T12:00:00');
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const diff = Math.round((d - today) / 86400000);
    if (diff === 0) return t.today;
    if (diff === 1) return t.tomorrow;
    return t.weekdaysShort[d.getDay()];
  };

  const scale = useResponsiveFontScale(containerRef, {
    baseWidth: 220,
    baseHeight: 260,
    min: 0.75,
    max: 2.6
  });

  useEffect(() => { setSettings(getAppSettings(appId)); }, [appId]);

  useEffect(() => {
    if (settings.location) fetchWeather();
  }, [settings.location, settings.units]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchWeather = async () => {
    if (!settings.location) return;

    console.log('[Weather] Selected location:', settings.location, '| Units:', settings.units);
    setLoading(true);
    setError('');

    try {
      const geoRes  = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(settings.location)}&count=1&language=en&format=json`
      );
      if (!geoRes.ok) throw new Error('Location lookup failed');

      const geoData = await geoRes.json();
      if (!geoData.results?.length) throw new Error('Location not found');

      const loc = geoData.results[0];
      const { latitude, longitude } = loc;
      console.log(`[Weather] Coordinates — lat: ${latitude}, lon: ${longitude} (${loc.name}, ${loc.country})`);

      const unit = settings.units === 'celsius' ? 'celsius' : 'fahrenheit';
      const weatherRes = await fetch(
        `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${latitude}&longitude=${longitude}` +
        `&current=temperature_2m,apparent_temperature,weathercode,wind_speed_10m` +
        `&daily=weathercode,temperature_2m_max,temperature_2m_min` +
        `&temperature_unit=${unit}` +
        `&wind_speed_unit=ms` +
        `&timezone=auto`
      );
      if (!weatherRes.ok) throw new Error('Weather fetch failed');

      const json        = await weatherRes.json();
      const current     = json.current;
      const daily       = json.daily;
      const displayName = `${loc.name}${loc.admin1 ? ', ' + loc.admin1 : ''}`;

      console.log(`[Weather] API success — ${displayName}: ${current.temperature_2m}° feels ${current.apparent_temperature}°, code: ${current.weathercode}`);

      setWeatherData({
        temperature:   current.temperature_2m,
        feelsLike:     current.apparent_temperature,
        weathercode:   current.weathercode,
        windspeed:     current.wind_speed_10m,
        location:      displayName,
        forecast:      daily.time.map((date, i) => ({
          date,
          code:    daily.weathercode[i],
          high:    daily.temperature_2m_max[i],
          low:     daily.temperature_2m_min[i]
        })).slice(0, 5)
      });
    } catch (err) {
      console.error('[Weather] API error:', err.message);
      setError('Unable to fetch weather data');
    } finally {
      setLoading(false);
    }
  };

  // ── Sizing ─────────────────────────────────────────────────────────────
  const s = (base) => Math.round(base * scale);
  const unit = settings.units === 'celsius' ? '°C' : '°F';

  // ── States ─────────────────────────────────────────────────────────────

  if (!settings.location) {
    return (
      <div ref={containerRef} className="w-full h-full flex flex-col items-center justify-center text-white/40" style={{ fontSize: s(13) }}>
        <div style={{ fontSize: s(26), marginBottom: 8 }}>🌤</div>
        Set location in settings
      </div>
    );
  }

  if (loading) {
    return (
      <div ref={containerRef} className="w-full h-full flex items-center justify-center text-white/30" style={{ fontSize: s(13), letterSpacing: '0.08em' }}>
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div ref={containerRef} className="w-full h-full flex flex-col items-center justify-center text-white/40 text-center" style={{ fontSize: s(12) }}>
        <div style={{ fontSize: s(22), marginBottom: 6 }}>—</div>
        {error}
      </div>
    );
  }

  if (!weatherData) return <div ref={containerRef} className="w-full h-full" />;

  // ── Main weather display ───────────────────────────────────────────────

  const { temperature, feelsLike, weathercode, location, forecast } = weatherData;

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex flex-col"
      style={{ padding: `${s(14)}px ${s(16)}px`, gap: 0 }}
    >
      {/* ── Current section ── */}
      <div className="flex items-center justify-between" style={{ marginBottom: s(2) }}>
        {/* Temperature + feels like */}
        <div style={{ lineHeight: 1 }}>
          <div
            className="text-white font-light"
            style={{ fontSize: s(52), letterSpacing: '-0.02em', lineHeight: 1 }}
          >
            {Math.round(temperature)}<span style={{ fontSize: s(24), opacity: 0.7 }}>{unit}</span>
          </div>
          <div
            className="text-white/50"
            style={{ fontSize: s(12), marginTop: s(4), letterSpacing: '0.03em' }}
          >
            {t.feelsLike} {Math.round(feelsLike)}{unit}
          </div>
        </div>

        {/* Large icon + description */}
        <div className="flex flex-col items-end" style={{ gap: s(4) }}>
          <div style={{ fontSize: s(36), lineHeight: 1 }}>
            {weatherIcon(weathercode)}
          </div>
          <div
            className="text-white/50 text-right"
            style={{ fontSize: s(11), letterSpacing: '0.04em', maxWidth: s(90) }}
          >
            {weatherDesc(weathercode)}
          </div>
        </div>
      </div>

      {/* Location line */}
      <div
        className="text-white/35"
        style={{ fontSize: s(11), letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: s(10) }}
      >
        {location}
      </div>

      {/* Divider */}
      <div
        className="w-full bg-white/10"
        style={{ height: 1, marginBottom: s(10) }}
      />

      {/* ── Forecast rows ── */}
      <div className="flex flex-col" style={{ gap: s(4) }}>
        {forecast.map((day, i) => (
          <div
            key={day.date}
            className="flex items-center justify-between"
            style={{ opacity: i === 0 ? 1 : 0.65 + (0.35 * (1 - i / forecast.length)) }}
          >
            {/* Day name */}
            <div
              className="text-white/80"
              style={{ fontSize: s(12), width: s(68), letterSpacing: '0.02em' }}
            >
              {dayName(day.date)}
            </div>

            {/* Icon */}
            <div style={{ fontSize: s(14), width: s(20), textAlign: 'center' }}>
              {weatherIcon(day.code)}
            </div>

            {/* High / Low */}
            <div
              className="flex items-baseline"
              style={{ gap: s(6), minWidth: s(72), justifyContent: 'flex-end' }}
            >
              <span className="text-white/90" style={{ fontSize: s(12) }}>
                {Math.round(day.high)}°
              </span>
              <span className="text-white/35" style={{ fontSize: s(11) }}>
                {Math.round(day.low)}°
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default WeatherApp;
