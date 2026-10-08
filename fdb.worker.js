// Runs FragmentDB off the main thread. Use with: client(new Worker(new URL('./fdb.worker.js', import.meta.url), { type: 'module' }))
import { serve } from './fragmentdb.js';
serve(self);
