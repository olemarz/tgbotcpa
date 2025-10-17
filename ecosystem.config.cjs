module.exports = {
  apps: [{
    name: 'tg-api',
    script: 'src/api/server.js',
    cwd: '/opt/tgbotcpa',
    node_args: '--enable-source-maps',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',

      // HTTP
      PORT: 8000,
      BIND_HOST: '127.0.0.1',

      // Бот/вебхук
      BASE_URL: 'https://adspirin.ru',
      WEBHOOK_PATH: '/bot/webhook',
      BOT_TOKEN: '8426830327:AAH7oAyEn23PZ_lLOECnevInjrO94fh2uqI',

      // База данных (замени USER/PASSWORD/HOST/DBNAME на реальные)
      DATABASE_URL: 'postgresql://neondb_owner:npg_mhQ8bFIo1EGY@ep-solitary-sun-adyv55oz-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',

      // Бизнес-настройки
      HIGH_GEO_LIST: 'US,CA,DE,GB',     // +30% к payout по этим GEO
      ADMIN_TG_ID: '0',                 // опционально: твой tg id (числом/строкой)
      ADMIN_TOKEN: 'super-admin-token'  // опционально: для /api/offers
    }
  }]
}
