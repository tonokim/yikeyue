import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer, StartedTestContainer } from "testcontainers";

let pgContainer: StartedPostgreSqlContainer;
let redisContainer: StartedTestContainer;

/**
 * Vitest Global Setup.
 * Design Invariant: 10.2 - Spin up PG and Redis container once and share across all tests.
 * Default export must be a function, returning the teardown function.
 */
export default async function () {
  // Disable testcontainers console logs to keep test output clean
  process.env.DEBUG = "";

  // Start PostgreSQL container
  pgContainer = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("yikeyue_test")
    .withUsername("postgres")
    .withPassword("postgres")
    .start();

  // Start Redis container using GenericContainer
  redisContainer = await new GenericContainer("redis:7-alpine")
    .withExposedPorts(6379)
    .start();

  const pgUrl = pgContainer.getConnectionUri();
  const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;

  // Propagate connection strings to worker processes via process.env
  process.env.TEST_DATABASE_URL = pgUrl;
  process.env.TEST_REDIS_URL = redisUrl;
  process.env.DATABASE_URL = pgUrl;
  process.env.REDIS_URL = redisUrl;
  process.env.JWT_SECRET = "test-jwt-secret-key-at-least-32-chars-long";

  // Return the teardown callback
  return async () => {
    if (pgContainer) {
      await pgContainer.stop();
    }
    if (redisContainer) {
      await redisContainer.stop();
    }
  };
}
