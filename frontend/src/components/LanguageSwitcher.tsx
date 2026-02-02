import { useTranslation } from 'react-i18next';

export default function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');

  const toggle = () => {
    const newLang = isZh ? 'en' : 'zh';
    i18n.changeLanguage(newLang);
  };

  return (
    <button
      onClick={toggle}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all
        bg-gray-700/60 hover:bg-gray-600/80 text-gray-300 hover:text-white border border-gray-600/50 hover:border-gray-500
        ${className}`}
      title={isZh ? 'Switch to English' : '切换到中文'}
    >
      <span className="text-sm">🌐</span>
      <span className={isZh ? 'opacity-50' : 'opacity-100'}>EN</span>
      <span className="text-gray-500">|</span>
      <span className={isZh ? 'opacity-100' : 'opacity-50'}>中文</span>
    </button>
  );
}
