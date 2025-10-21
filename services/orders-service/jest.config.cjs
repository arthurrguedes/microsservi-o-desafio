module.exports = {
  transform: {
    '^.+\\.js$': 'babel-jest',
  },
  transformIgnorePatterns: [
    '/node_modules/(?!nanoid|node-fetch|data-uri-to-buffer|fetch-blob|formdata-polyfill)',
  ],
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  clearMocks: true,
  moduleNameMapper: {
    '^@common/(.*)$': '<rootDir>/../../common/$1',
  },
};