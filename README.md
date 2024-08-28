# Hypercore E2E tests

Hypercore replication end-to-end tests.

## Run

### Docker

#### Create

docker run --network=host \
 --mount type=volume,source=hypercore-e2e-tests-create-volume,destination=/home/hypercore-e2e-tests/corestore \
 --env HYPERCORE_E2E_PROMETHEUS_SECRET=... \
 --env HYPERCORE_E2E_PROMETHEUS_SCRAPER_PUBLIC_KEY=... \
 --env HYPERCORE_E2E_LENGTH=...(the length of the core to create) \
  ghcr.io/holepunchto/hypercore-e2e-tests-create

#### Seed

```
docker run --network=host \
 --mount type=volume,source=hypercore-e2e-tests-seed-volume,destination=/home/hypercore-e2e-tests/corestore \
 --env HYPERCORE_E2E_PROMETHEUS_SECRET=... \
 --env HYPERCORE_E2E_PROMETHEUS_SCRAPER_PUBLIC_KEY=... \
 --env HYPERCORE_E2E_KEY=...(the key of the core to download) \
 --env HYPERCORE_E2E_BYTE_LENGTH=... (the byte length of the core to download) \
 --env HYPERCORE_E2E_LENGTH==... (the length of the core to download) \
 ghcr.io/holepunchto/hypercore-e2e-tests-seeder
```
