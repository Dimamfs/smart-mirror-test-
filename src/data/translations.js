export const LANGUAGES = [
  { id: 'en', label: 'English', nativeLabel: 'English' },
  { id: 'tr', label: 'Turkish', nativeLabel: 'Türkçe' }
];

const translations = {
  en: {
    // Date/Time
    weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    weekdaysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],

    // Weather
    today: 'Today',
    tomorrow: 'Tomorrow',
    feelsLike: 'Feels like',
    humidity: 'Humidity',
    wind: 'Wind',
    weatherDesc: {
      0: 'Clear sky',        1: 'Mainly clear',        2: 'Partly cloudy',      3: 'Overcast',
      45: 'Fog',             48: 'Rime fog',
      51: 'Light drizzle',   53: 'Drizzle',             55: 'Heavy drizzle',
      56: 'Freezing drizzle',57: 'Heavy freezing drizzle',
      61: 'Light rain',      63: 'Rain',                65: 'Heavy rain',
      66: 'Freezing rain',   67: 'Heavy freezing rain',
      71: 'Light snow',      73: 'Snow',                75: 'Heavy snow',        77: 'Snow grains',
      80: 'Rain showers',    81: 'Showers',             82: 'Heavy showers',
      85: 'Snow showers',    86: 'Heavy snow showers',
      95: 'Thunderstorm',    96: 'Thunderstorm',        99: 'Thunderstorm'
    },

    // News
    newsLoading: 'Loading…',
    newsError: 'Unable to load news',
    newsUpdating: 'updating…',
    newsTitle: 'News'
  },

  tr: {
    // Date/Time
    weekdays: ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'],
    weekdaysShort: ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'],
    months: ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'],

    // Weather
    today: 'Bugün',
    tomorrow: 'Yarın',
    feelsLike: 'Hissedilen',
    humidity: 'Nem',
    wind: 'Rüzgar',
    weatherDesc: {
      0: 'Açık hava',        1: 'Çoğunlukla açık',     2: 'Parçalı bulutlu',    3: 'Kapalı',
      45: 'Sis',             48: 'Kırağı sisi',
      51: 'Hafif çisenti',   53: 'Çisenti',             55: 'Yoğun çisenti',
      56: 'Dondurucu çisenti',57: 'Yoğun dondurucu çisenti',
      61: 'Hafif yağmur',    63: 'Yağmur',              65: 'Şiddetli yağmur',
      66: 'Dondurucu yağmur',67: 'Şiddetli dondurucu yağmur',
      71: 'Hafif kar',       73: 'Kar',                 75: 'Yoğun kar',         77: 'Kar taneleri',
      80: 'Yağmur sağanağı', 81: 'Sağanak',             82: 'Şiddetli sağanak',
      85: 'Kar sağanağı',    86: 'Şiddetli kar sağanağı',
      95: 'Fırtına',         96: 'Fırtına',             99: 'Fırtına'
    },

    // News
    newsLoading: 'Yükleniyor…',
    newsError: 'Haberler yüklenemedi',
    newsUpdating: 'güncelleniyor…',
    newsTitle: 'Haberler'
  }
};

export const getTranslations = (lang = 'en') =>
  translations[lang] || translations.en;
