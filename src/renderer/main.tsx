import '@fontsource-variable/noto-sans-sc/index.css';
// Windows-only HarmonyOS face; vite aliases this to an empty stub on macOS/Linux
// so darwin npm start does not require harmonyos-sans-sc-webfont-splitted.
import './harmonyos-sans-sc-windows.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { ElevationProvider } from './ElevationProvider';
import { InspectorCardFeelProvider } from './InspectorCardFeelProvider';
import { LocaleProvider } from './i18n';
import { MenuAcrylicProvider } from './MenuAcrylicProvider';
import { applyRendererPlatform } from './renderer-platform';
import {
  applyMenuAcrylicPreferences,
  loadMenuAcrylicPreferences,
} from './menu-acrylic-preferences';
import {
  applyShadowPreferences,
  loadShadowPreferences,
} from './shadow-preferences';
import { ThemeProvider } from './theme';
import './styles.css';
import './ui/tokens.css';
import './ui/ui.css';

applyRendererPlatform(document.documentElement, navigator.userAgent);
// Apply elev level before first paint so level 0 never flashes shell shadows.
applyShadowPreferences(loadShadowPreferences());
// Apply menu acrylic before first paint so the shared context-menu surface does
// not flash from the opaque default while React providers mount.
applyMenuAcrylicPreferences(loadMenuAcrylicPreferences());

const root = document.getElementById('root');

if (!root) {
  throw new Error('Renderer root element is missing.');
}

createRoot(root).render(
  <StrictMode>
    <LocaleProvider>
      <ThemeProvider>
        <ElevationProvider>
          <MenuAcrylicProvider>
            <InspectorCardFeelProvider>
              <App />
            </InspectorCardFeelProvider>
          </MenuAcrylicProvider>
        </ElevationProvider>
      </ThemeProvider>
    </LocaleProvider>
  </StrictMode>,
);
