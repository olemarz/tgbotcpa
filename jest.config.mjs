export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.spec.js'],
  collectCoverage: false,
  setupFiles: ['<rootDir>/tests/setup-env.js']
};
