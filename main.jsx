import { createRoot } from 'react-dom/client';
import { serve } from './fragmentdb.js';
import App from './App.jsx';

// ?bridge=1 turns this page into a headless codec other sites can embed in an iframe and call via postMessage.
if (new URLSearchParams(location.search).has('bridge')) serve(window, { origins: [location.origin] });
else createRoot(document.getElementById('root')).render(<App />);
