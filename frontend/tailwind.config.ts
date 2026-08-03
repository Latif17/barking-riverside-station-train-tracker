import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        'bg-primary': 'var(--bg-primary)',
        'bg-secondary': 'var(--bg-secondary)',
        'bg-widget': 'var(--bg-widget)',
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'border-color': 'var(--border-color)',
        'status-on-time': 'var(--status-on-time)',
        'status-delayed': 'var(--status-delayed)',
        'status-cancelled': 'var(--status-cancelled)',
      },
    },
  },
  plugins: [],
};
export default config;

