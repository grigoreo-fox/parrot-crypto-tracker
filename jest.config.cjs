module.exports = {
  testEnvironment: 'node',
  watchman: false,
  roots: ['<rootDir>/dist'],
  testMatch: ['**/*.test.js'],
  collectCoverageFrom: [
    '<rootDir>/dist/src/**/*.js',
    '!<rootDir>/dist/src/ui/**',
    '!<rootDir>/dist/src/docs/init.js',
  ],
  coverageReporters: ['text', 'html', 'lcov', 'json-summary'],
};
