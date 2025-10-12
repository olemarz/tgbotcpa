module.exports = {
  apps: [{
    name: "tg-api",
    cwd: "/opt/tgbotcpa",
    script: "src/api/server.js",
    interpreter: "node",
    env: { NODE_ENV: "production" },
    autorestart: true,
    time: true,
    max_memory_restart: "300M"
  }]
};
