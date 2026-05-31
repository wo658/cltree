module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Run serially because tmux tests share global state (the tmux server)
  maxWorkers: 1,
  roots: ['<rootDir>/tests'],
  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.server.json' }],
  },
};
