import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Barking Riverside Train Tracker',
  description: 'How often trains at Barking Riverside are cancelled or delayed, by time of day.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
