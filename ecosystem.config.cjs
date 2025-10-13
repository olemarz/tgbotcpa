module.exports = {
  apps: [{
    name: 'tg-api',
    script: 'npm',
    args: 'start',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    env: {
      APP_VERSION: String(Date.now()),
      NODE_ENV: process.env.NODE_ENV || "production",
      SOCK_PATH: process.env.SOCK_PATH || "/tmp/tg-api.sock"
    },
    autorestart: true,
    time: true,
    max_memory_restart: "300M"
  }]
};
