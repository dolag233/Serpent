import '@fontsource-variable/noto-sans-sc/index.css';
// Windows-only HarmonyOS face; vite aliases this to an empty stub on macOS/Linux
// so darwin npm start does not require harmonyos-sans-sc-webfont-splitted.
import './harmonyos-sans-sc-windows.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { LocaleProvider } from './i18n';
import { applyRendererPlatform } from './renderer-platform';
import { ThemeProvider } from './theme';
import './styles.css';

applyRendererPlatform(document.documentElement, navigator.userAgent);

const root = document.getElementById('root');

if (!root) {
  throw new Error('Renderer root element is missing.');
}

createRoot(root).render(
  <StrictMode>
    <LocaleProvider>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </LocaleProvider>
  </StrictMode>,
);
