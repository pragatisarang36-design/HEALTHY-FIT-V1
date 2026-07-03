import { useState, useEffect } from 'react';

export function useDarkMode() {
  const [isDark, setIsDark] = useState(() => {
    if (typeof localStorage === 'undefined') return true;
    return localStorage.getItem('healthy-fit:theme') !== 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('healthy-fit:theme', isDark ? 'dark' : 'light');
    }
  }, [isDark]);

  return { isDark, setIsDark, toggle: () => setIsDark(prev => !prev) };
}
