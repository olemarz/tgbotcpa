module.exports = {
  apps: [
    {
      name: "tg-api",
      script: "src/api/server.js",
      watch: false,
      autorestart: true,
      time: true,
      env: {
        NODE_ENV: "production"
        // PORT и остальные берутся из .env через dotenv/config в коде.
      }
    }
  ]
};
