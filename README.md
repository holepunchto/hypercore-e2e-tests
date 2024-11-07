# Hypercore E2E tests

Hypercore replication end-to-end tests.

## Run

### CLI

```
npm i -g hypercore-e2e-tests pino-pretty
```

#### Create

```
HYPERCORE_E2E_LENGTH=15250 HYPERCORE_E2E_BLOCK_SIZE_BYTES=65536 hypercore-e2e-create | pino-pretty
```

#### Seed

```
HYPERCORE_E2E_KEY=<public key printed by create process> HYPERCORE_E2E_LENGTH=15250 HYPERCORE_E2E_BLOCK_SIZE_BYTES=65536 hypercore-e2e-seed | pino-pretty
```

#### Download

```
HYPERCORE_E2E_KEY=<public key printed by create process> HYPERCORE_E2E_LENGTH=15250 HYPERCORE_E2E_BLOCK_SIZE_BYTES=65536 hypercore-e2e-download | pino-pretty
```

### Docker

Note: the `PROMETHEUS_*` environment variables are optional. If set, the process will connect to the specified dht-prometheus scraper before starting the experiment.

#### Create

```
docker run --network=host \
 --mount type=volume,source=hypercore-e2e-tests-create-volume,destination=/home/hypercore-e2e-tests/corestore \
 --env HYPERCORE_E2E_PROMETHEUS_SECRET=... \
 --env HYPERCORE_E2E_PROMETHEUS_SCRAPER_PUBLIC_KEY=... \
 --env HYPERCORE_E2E_LENGTH=...(the length of the core to create) \
  ghcr.io/holepunchto/hypercore-e2e-tests-create
```

#### Seed

```
docker run --network=host \
 --mount type=volume,source=hypercore-e2e-tests-seed-volume,destination=/home/hypercore-e2e-tests/corestore \
 --env HYPERCORE_E2E_PROMETHEUS_SECRET=... \
 --env HYPERCORE_E2E_PROMETHEUS_SCRAPER_PUBLIC_KEY=... \
 --env HYPERCORE_E2E_KEY=...(the key of the core to download) \
 --env HYPERCORE_E2E_BYTE_LENGTH=... (the byte length of the core to download) \
 --env HYPERCORE_E2E_LENGTH==... (the length of the core to download) \
 ghcr.io/holepunchto/hypercore-e2e-tests-seed
```

#### Download

```
docker run --network=host \
 --env HYPERCORE_E2E_PROMETHEUS_SECRET=... \
 --env HYPERCORE_E2E_PROMETHEUS_SCRAPER_PUBLIC_KEY=... \
 --env HYPERCORE_E2E_KEY=... \
 --env HYPERCORE_E2E_BYTE_LENGTH=... (the byte length of the core to download) \
 --env HYPERCORE_E2E_LENGTH==... (the length of the core to download) \
 ghcr.io/holepunchto/hypercore-e2e-tests-download
```
