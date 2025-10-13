module.exports = {
  apps: [{
    name: 'tg-api',
    script: 'npm',
    args: 'start',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    env: {
      NODE_ENV: 'production',
      PORT: 8000,
      APP_VERSION: String(Date.now())
    }
  }]
};
