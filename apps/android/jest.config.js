module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  moduleNameMapper: {
    "^@agent-orchestrator/shared$":
      "<rootDir>/../../packages/shared/src/index.ts",
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      { tsconfig: "tsconfig.json", diagnostics: false },
    ],
  },
  testMatch: ["**/__tests__/**/*.test.(ts|tsx)", "**/?(*.)+test.(ts|tsx)"],
};
