module.exports = {
  apps: [{
    name: "tg-api",
    cwd: "/opt/tgbotcpa",
    script: "src/api/server.js",
    interpreter: "node",
    env: {
      APP_VERSION: String(Date.now()),
      NODE_ENV: process.env.NODE_ENV || "production"
    },
    autorestart: true,
    time: true,
    max_memory_restart: "300M"
  }]
};
