#! /usr/bin/env node

const os = require('os')
const { once } = require('events')

const idEnc = require('hypercore-id-encoding')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const pino = require('pino')
const goodbye = require('graceful-goodbye')
const formatBytes = require('tiny-byte-size')
const promClient = require('prom-client')
const instrument = require('./lib/instrument')

function loadConfig () {
  let key = null
  try {
    key = idEnc.normalize(process.env.HYPERCORE_E2E_KEY)
  } catch (err) {
    console.log(err)
    console.error('HYPERCORE_E2E_KEY ENV var must be set to a valid key')
    process.exit(1)
  }

  if (process.env.HYPERCORE_E2E_LENGTH === undefined) {
    console.error('HYPERCORE_E2E_LENGTH must be set to the length of the hypercore, as a sanity check')
    process.exit(1)
  }
  const coreLength = parseInt(process.env.HYPERCORE_E2E_LENGTH)

  if (process.env.HYPERCORE_E2E_BLOCK_SIZE_BYTES === undefined) {
    console.error('HYPERCORE_E2E_BLOCK_SIZE_BYTES must be set, as a sanity check')
    process.exit(1)
  }
  const blockSizeBytes = parseInt(process.env.HYPERCORE_E2E_BLOCK_SIZE_BYTES)
  const coreByteLength = coreLength * blockSizeBytes

  const config = {
    key,
    coreLength,
    coreByteLength,
    blockSizeBytes,
    corestoreLoc: process.env.HYPERCORE_E2E_CORESTORE_LOC || 'e2e-tests-seeder-corestore',
    logLevel: process.env.HYPERCORE_E2E_LOG_LEVEL || 'info'
  }

  if (process.env.HYPERCORE_E2E_PROMETHEUS_SECRET) {
    config.prometheusServiceName = 'hypercore-e2e-tests'
    config.prometheusAlias = process.env.HYPERCORE_E2E_PROMETHEUS_ALIAS || `hypercore-e2e-seed-${formatBytes(coreByteLength)}-${os.hostname()}`.replace(' ', '-')

    try {
      config.prometheusSecret = idEnc.decode(process.env.HYPERCORE_E2E_PROMETHEUS_SECRET)
      config.prometheusScraperPublicKey = idEnc.decode(process.env.HYPERCORE_E2E_PROMETHEUS_SCRAPER_PUBLIC_KEY)
    } catch (error) {
      console.error(error)
      console.error('HYPERCORE_E2E_PROMETHEUS_SECRET and HYPERCORE_E2E_PROMETHEUS_SCRAPER_PUBLIC_KEY must be set to valid keys')
      process.exit(1)
    }
  }

  return config
}

async function main () {
  const config = loadConfig()
  const { key, corestoreLoc, logLevel, coreLength, coreByteLength, blockSizeBytes } = config

  const logger = pino({ level: logLevel })

  logger.info(`Starting hypercore-e2e-seeder for a core of ${formatBytes(coreByteLength)} with blocks of ${formatBytes(blockSizeBytes)} at public key ${idEnc.normalize(key)}`)

  const store = new Corestore(corestoreLoc)
  const swarm = new Hyperswarm()
  let nrConnections = 0
  swarm.on('connection', (conn) => {
    nrConnections++
    logger.info(`Connected to peer (total ${nrConnections})`)
    conn.on('close', () => {
      nrConnections--
      logger.info(`Disconnected from peer (total ${nrConnections})`)
    })
    store.replicate(conn)
  })

  let promRpcClient = null
  if (config.prometheusAlias) {
    const {
      prometheusScraperPublicKey,
      prometheusAlias,
      prometheusSecret,
      prometheusServiceName
    } = config

    promRpcClient = instrument(logger, store, swarm, {
      promClient,
      prometheusScraperPublicKey,
      prometheusAlias,
      prometheusSecret,
      prometheusServiceName
    })
  }

  const core = store.get({ key })
  core.on('append', () => {
    logger.info(`core updated (length: ${core.length})`)
    if (core.length > coreLength) {
      logger.error(`Core grew past the expected length of ${coreLength} (current length: ${core.length})`)
      process.exit(1)
    }
  })
  core.on('download', async () => {
    if (core.contiguousLength === coreLength) {
      const { byteLength } = await core.info()
      if (byteLength !== coreByteLength) {
        console.error(`The hypercore does not have the expected byte length of ${coreByteLength} (saw ${byteLength})`)
        process.exit(1)
      }
      logger.info('Core fully downloaded')
    }
  })

  goodbye(async () => {
    try {
      logger.info('Shutting down')
      if (promRpcClient) {
        await promRpcClient.close()
        logger.info('Prom-rpc client shut down')
      }
      await swarm.destroy()
      logger.info('swarm shut down')
      await store.close()
    } catch (e) {
      logger.error(`Error while shutting down ${e.stack}`)
    }

    logger.info('Successfully shut down')
  })

  if (promRpcClient) {
    // Don't start the experiment until our metrics are being scraped
    await Promise.all([
      promRpcClient.ready(),
      once(promRpcClient, 'metrics-success')
    ])
    logger.info('Instrumentation setup')
  }

  await core.ready()

  swarm.join(core.discoveryKey, { client: true, server: true })
  core.download({ start: 0, end: -1 })

  logger.info(`Started downloading (current length: ${core.length} of ${coreLength})`)
  if (core.length > coreLength) {
    logger.error(`Core grew past the expected length of ${coreLength} (current length: ${core.length})`)
    process.exit(1)
  }

  if (core.contiguousLength === coreLength) {
    const { byteLength } = await core.info()
    if (byteLength !== coreByteLength) {
      console.error(`The hypercore does not have the expected byte length of ${coreByteLength} (saw ${byteLength})`)
      process.exit(1)
    }
    logger.info('Core fully downloaded')
  }
}

main()
