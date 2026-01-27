'use client';

import { useEffect, useState } from 'react';
import { Navbar } from './Navbar';
import { useAppStore } from '@/lib/stores/appStore';

interface MainLayoutProps {
  children: React.ReactNode;
  showNavbar?: boolean;
}

export function MainLayout({ children, showNavbar = true }: MainLayoutProps) {
  const theme = useAppStore((state) => state.preferences.theme);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Apply theme class to document
  useEffect(() => {
    if (!mounted) return;

    const root = document.documentElement;
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    const actualTheme: 'light' | 'dark' =
      theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

    root.classList.remove('light', 'dark');
    root.classList.add(actualTheme);

    // Listen for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (theme === 'system') {
        const newTheme = mediaQuery.matches ? 'dark' : 'light';
        root.classList.remove('light', 'dark');
        root.classList.add(newTheme);
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme, mounted]);

  return (
    <div className="min-h-screen bg-okx-bg-primary text-okx-text-primary">
      {showNavbar && <Navbar />}
      {children}
    </div>
  );
}
