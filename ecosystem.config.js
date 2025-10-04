module.exports = {
  apps: [
    {
      name: "tg-api",
      script: "src/api/server.js",
      env: { NODE_ENV: "production" }
    }
  ]
};
