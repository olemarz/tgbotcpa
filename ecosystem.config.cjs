module.exports = {
  apps: [{
    name: "tg-api",
    cwd: "/opt/tgbotcpa",
    script: "npm",
    args: "start",
    env: { NODE_ENV: "production" },
    autorestart: true,
    time: true,
    max_memory_restart: "300M"
  }]
};
