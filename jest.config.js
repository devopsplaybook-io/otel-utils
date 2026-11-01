module.exports = {
  moduleFileExtensions: ["ts", "js"],
  transform: {
    "^.+\\.(ts|tsx)$": [
      "@swc/jest",
      {
        jsc: {
          target: "es2022",
        },
      },
    ],
  },
  coverageProvider: "v8",
  coverageThreshold: {
    global: {
      statements: 96,
      branches: 94,
      functions: 100,
      lines: 96,
    },
  },
  testMatch: ["/**/src/**/*.spec.(ts|js)"],
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
  testEnvironment: "node",
};
