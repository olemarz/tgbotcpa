// Каноничная точка входа для постбеков из бота/ивентов.
// Под капотом используем utils/postbackSender.js
export { sendPostbackForEvent, sendPostbackForEvent as sendPostback } from '../utils/postbackSender.js';
