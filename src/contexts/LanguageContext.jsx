import { createContext, useContext, useState, useEffect } from 'react';
import { getGeneralSettings } from '../data/generalSettings';
import { getTranslations } from '../data/translations';

const LanguageContext = createContext({ lang: 'en', t: getTranslations('en') });

export const LanguageProvider = ({ children }) => {
  const [lang, setLang] = useState(() => getGeneralSettings().language || 'en');

  useEffect(() => {
    const sync = () => {
      const newLang = getGeneralSettings().language || 'en';
      setLang(newLang);
    };
    window.addEventListener('smartMirror:generalSettingsChanged', sync);
    return () => window.removeEventListener('smartMirror:generalSettingsChanged', sync);
  }, []);

  return (
    <LanguageContext.Provider value={{ lang, t: getTranslations(lang) }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => useContext(LanguageContext);
