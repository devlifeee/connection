import { useState, useEffect } from 'react';

type Theme = 'dark' | 'light';
export type FontSize = 'small' | 'medium' | 'large';

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || saved === 'light') return saved;
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    return 'light';
  });

  const [fontSize, setFontSize] = useState<FontSize>(() => {
    const saved = localStorage.getItem('fontSize');
    if (saved === 'small' || saved === 'medium' || saved === 'large') return saved;
    return 'medium';
  });

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('text-sm', 'text-base', 'text-lg', 'font-size-small', 'font-size-medium', 'font-size-large');
    // We use data-attribute for easier CSS targeting or specific classes
    root.setAttribute('data-font-size', fontSize);
    localStorage.setItem('fontSize', fontSize);
    
    // Also apply a base scale transform if needed, but CSS variables are better.
    // Let's use CSS variables for scaling
    const scale = fontSize === 'small' ? '0.875rem' : fontSize === 'large' ? '1.125rem' : '1rem';
    root.style.fontSize = scale;
  }, [fontSize]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  return { theme, toggleTheme, setTheme, fontSize, setFontSize };
}
