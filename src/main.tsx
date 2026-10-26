import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { preloadParentModels } from './graphics/modelLoader';

// Optional Blender models for Mom and Dad load before the car is built (no hot-swap). Off by
// default, when this resolves at once; see src/graphics/modelLoader.ts.
preloadParentModels().finally(() => {
  createRoot(document.getElementById('root')!).render(<App />);
});
