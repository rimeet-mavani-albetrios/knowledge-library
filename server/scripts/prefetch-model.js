// Downloads the small search model during the build, so the server doesn't have to after every restart.
import { embed } from '../robot/embed.js';

await embed('warm up');
console.log('Search model is ready.');
