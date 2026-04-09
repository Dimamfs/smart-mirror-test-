import { useState, useEffect, useCallback, useRef } from 'react';
import { getAppSettings } from '../data/apps';
import useResponsiveFontScale from '../hooks/useResponsiveFontScale';
import { useLanguage } from '../contexts/LanguageContext';

// ── News source registry ───────────────────────────────────────────────────

export const NEWS_SOURCES = {
  bbc: {
    id: 'bbc',
    name: 'BBC',
    url: 'https://feeds.bbci.co.uk/news/world/rss.xml'
  },
  aljazeera: {
    id: 'aljazeera',
    name: 'Al Jazeera',
    url: 'https://www.aljazeera.com/xml/rss/all.xml'
  },
  trt: {
    id: 'trt',
    name: 'TRT World',
    url: 'https://www.trtworld.com/rss'
  },
  turkishminute: {
    id: 'turkishminute',
    name: 'Turkish Minute',
    url: 'https://www.turkishminute.com/feed/'
  }
};

export const DEFAULT_SOURCES = ['bbc', 'trt'];

// ── RSS fetch helpers ──────────────────────────────────────────────────────

// CORS proxies — tried in order until one works
const PROXIES = [
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

/** Strips CDATA wrappers and HTML tags from an RSS text node */
const clean = (str = '') =>
  str.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim();

/** Tries each proxy in order, returns the first successful XML document */
const fetchWithFallback = async (url) => {
  let lastError;
  for (const makeProxyUrl of PROXIES) {
    try {
      const res = await fetch(makeProxyUrl(url), { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text   = await res.text();
      const parser = new DOMParser();
      const doc    = parser.parseFromString(text, 'text/xml');
      if (doc.querySelector('parsererror')) throw new Error('XML parse error');
      return doc;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
};

/**
 * Fetches one RSS feed trying multiple CORS proxies, parses the XML directly.
 * Returns an array of article objects or throws on failure.
 */
const fetchSource = async (sourceId, perSource) => {
  const source = NEWS_SOURCES[sourceId];
  if (!source) throw new Error(`Unknown source: ${sourceId}`);

  const doc = await fetchWithFallback(source.url);

  const items = Array.from(doc.querySelectorAll('item')).slice(0, perSource);
  if (items.length === 0) throw new Error('No items in feed');

  return items.map((item, i) => {
    const title   = clean(item.querySelector('title')?.textContent || '');
    const desc    = clean(item.querySelector('description')?.textContent || '');
    const pubDate = item.querySelector('pubDate')?.textContent?.trim() || '';
    const guid    = item.querySelector('guid')?.textContent?.trim() || String(i);

    return {
      id:          `${sourceId}-${guid}`,
      title:       title || 'No title',
      summary:     desc.length > 130 ? desc.slice(0, 130) + '…' : desc,
      publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      source:      source.name
    };
  });
};

/**
 * Fetches all selected sources in parallel.
 * Failed sources are skipped (logged); successful ones are merged and sorted newest-first.
 */
const fetchAllSources = async (selectedSources, maxItems) => {
  const perSource = Math.max(3, Math.ceil(maxItems / selectedSources.length));

  console.log(`[News] Selected sources: ${selectedSources.join(', ')}`);

  const results = await Promise.allSettled(
    selectedSources.map(id => fetchSource(id, perSource))
  );

  const articles = [];
  results.forEach((result, i) => {
    const id = selectedSources[i];
    if (result.status === 'fulfilled') {
      console.log(`[News] ✓ ${id}: ${result.value.length} articles`);
      articles.push(...result.value);
    } else {
      console.warn(`[News] ✗ ${id} failed:`, result.reason?.message);
    }
  });

  if (articles.length === 0) throw new Error('All sources failed');

  // Sort newest-first, trim to maxItems
  return articles
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, maxItems);
};

// ── Component ──────────────────────────────────────────────────────────────

const NewsApp = ({ appId = 'news' }) => {
  const [news, setNews]       = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const containerRef          = useRef(null);
  const { t }                 = useLanguage();

  const scale = useResponsiveFontScale(containerRef, {
    baseWidth: 320,
    baseHeight: 360,
    min: 0.8,
    max: 2
  });

  const fetchNews = useCallback(async () => {
    const s        = getAppSettings(appId);
    const sources  = Array.isArray(s.sources) && s.sources.length > 0
      ? s.sources
      : DEFAULT_SOURCES;
    const maxItems = s.maxItems || 8;

    setLoading(true);
    setError('');

    try {
      const articles = await fetchAllSources(sources, maxItems);
      console.log(`[News] Loaded ${articles.length} total articles`);
      setNews(articles);
    } catch (err) {
      console.error('[News] All sources failed:', err.message);
      setError('Unable to load news');
    } finally {
      setLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    fetchNews();
    const s        = getAppSettings(appId);
    const interval = setInterval(fetchNews, s.refreshInterval || 300000);
    return () => clearInterval(interval);
  }, [appId, fetchNews]);

  // ── Formatting ─────────────────────────────────────────────────────────
  const formatTimeAgo = (ts) => {
    const mins = Math.floor((Date.now() - new Date(ts)) / 60000);
    if (mins < 60)   return `${mins}m ago`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
    return `${Math.floor(mins / 1440)}d ago`;
  };

  // ── Sizing ──────────────────────────────────────────────────────────────
  const headerSize  = Math.max(14, 16 * scale);
  const titleSize   = Math.max(12, 14 * scale);
  const summarySize = Math.max(11, 12 * scale);
  const metaSize    = Math.max(10, 11 * scale);

  // ── Render ──────────────────────────────────────────────────────────────
  let content;

  if (loading && news.length === 0) {
    content = (
      <div className="flex-1 flex items-center justify-center text-white/40" style={{ fontSize: summarySize }}>
        {t.newsLoading}
      </div>
    );
  } else if (error && news.length === 0) {
    content = (
      <div className="flex-1 flex flex-col items-center justify-center text-center text-white/40 space-y-2">
        <div style={{ fontSize: headerSize }}>📰</div>
        <div style={{ fontSize: summarySize }}>{t.newsError}</div>
      </div>
    );
  } else {
    content = (
      <div className="flex-1 overflow-auto space-y-3 pr-1">
        {news.map((article) => (
          <div key={article.id} className="border-b border-white/10 pb-3 last:border-b-0">
            <div
              className="text-white font-medium leading-tight mb-1"
              style={{ fontSize: titleSize }}
            >
              {article.title}
            </div>
            {article.summary && (
              <div
                className="text-white/55 leading-relaxed mb-1"
                style={{ fontSize: summarySize }}
              >
                {article.summary}
              </div>
            )}
            <div className="flex items-center gap-2 text-white/30" style={{ fontSize: metaSize }}>
              <span className="text-white/50 font-medium">{article.source}</span>
              <span>·</span>
              <span>{formatTimeAgo(article.publishedAt)}</span>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full h-full flex flex-col p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-white font-semibold" style={{ fontSize: headerSize }}>
          📰 {t.newsTitle}
        </div>
        {loading && news.length > 0 && (
          <div className="text-white/30" style={{ fontSize: metaSize }}>{t.newsUpdating}</div>
        )}
      </div>
      {content}
    </div>
  );
};

export default NewsApp;
