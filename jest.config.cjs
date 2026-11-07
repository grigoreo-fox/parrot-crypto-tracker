module.exports = {
  testEnvironment: 'node',
  watchman: false,
  roots: ['<rootDir>/dist'],
  testMatch: ['**/*.test.js'],
  collectCoverageFrom: ['<rootDir>/dist/src/**/*.js'],
  coverageReporters: ['text', 'html', 'lcov', 'json-summary'],
};
