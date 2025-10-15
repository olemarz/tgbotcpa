module.exports = {
  apps: [{
    name: 'tg-api',
    script: 'src/api/server.js',
    cwd: '/opt/tgbotcpa',
    node_args: '--enable-source-maps',
    env: {
      NODE_ENV: 'production',
      WEBHOOK_PATH: '/bot/webhook',
      // ⚠️ вставь свой реальный токен:
      BOT_TOKEN: '8426830327:AAH7oAyEn23PZ_lLOECnevInjrO94fh2uqI'
    }
  }]
}
