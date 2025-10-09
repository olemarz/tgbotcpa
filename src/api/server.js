import 'dotenv/config';
import { config } from '../config.js';
import { createApp } from './app.js';

const app = createApp();

app.listen(config.port, () => {
  console.log('API on', config.port);
});
