module.exports = {
  // Mapeia explicitamente todos os arquivos que terminam em .js para serem processados pelo transformador 'babel-jest'.
  transform: {
    '^.+\\.js$': 'babel-jest',
  },
  transformIgnorePatterns: ['/node_modules/(?!nanoid)'],

  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  clearMocks: true,
  moduleNameMapper: {
    '^@common/(.*)$': '<rootDir>/../../common/$1',
  },
};