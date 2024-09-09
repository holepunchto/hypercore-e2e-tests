const { once } = require('events')
const os = require('os')
const idEnc = require('hypercore-id-encoding')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const pino = require('pino')
const b4a = require('b4a')
const formatBytes = require('tiny-byte-size')
const goodbye = require('graceful-goodbye')
const instrument = require('./lib/instrument')
const promClient = require('prom-client')

function loadConfig () {
  const coreLength = parseInt(process.env.HYPERCORE_E2E_LENGTH)
  const blockSizeBytes = parseInt(process.env.HYPERCORE_E2E_BLOCK_SIZE_BYTES)

  const config = {
    coreLength,
    blockSizeBytes,
    corestoreLoc: process.env.HYPERCORE_E2E_CORESTORE_LOC || 'e2e-tests-creator-corestore',
    logLevel: process.env.HYPERCORE_E2E_LOG_LEVEL || 'info'
  }

  config.prometheusServiceName = 'hypercore-e2e-tests'
  config.prometheusAlias = process.env.HYPERCORE_E2E_PROMETHEUS_ALIAS || `hypercore-e2e-create-${formatBytes(coreLength * blockSizeBytes)}-${os.hostname()}`.replace(' ', '-')
  try {
    config.prometheusSecret = idEnc.decode(process.env.HYPERCORE_E2E_PROMETHEUS_SECRET)
    config.prometheusScraperPublicKey = idEnc.decode(process.env.HYPERCORE_E2E_PROMETHEUS_SCRAPER_PUBLIC_KEY)
  } catch (error) {
    console.error(error)
    console.error('HYPERCORE_E2E_PROMETHEUS_SECRET and HYPERCORE_E2E_PROMETHEUS_SCRAPER_PUBLIC_KEY must be set to valid keys')
    process.exit(1)
  }

  return config
}

async function main () {
  const config = loadConfig()
  const { blockSizeBytes, corestoreLoc, logLevel, coreLength } = config
  const {
    prometheusScraperPublicKey,
    prometheusAlias,
    prometheusSecret,
    prometheusServiceName
  } = config

  const logger = pino({ level: logLevel })

  logger.info('Starting hypercore-e2e-tests creator')

  const store = new Corestore(corestoreLoc)
  const swarm = new Hyperswarm()
  swarm.on('connection', (conn) => {
    store.replicate(conn)
  })

  const promRpcClient = instrument(logger, store, swarm, {
    promClient,
    prometheusScraperPublicKey,
    prometheusAlias,
    prometheusSecret,
    prometheusServiceName
  })

  const core = store.get({ name: `e2e-test-core-${coreLength}-${blockSizeBytes}` })

  goodbye(async () => {
    try {
      logger.info('Shutting down')
      await promRpcClient.close()
      logger.info('Prom-rpc client shut down')
      await swarm.destroy()
      logger.info('swarm shut down')
      await store.close()
    } catch (e) {
      logger.error(`Error while shutting down ${e.stack}`)
    }

    logger.info('Successfully shut down')
  })

  // Don't start the experiment until our metrics are being scraped
  await Promise.all([
    promRpcClient.ready(),
    once(promRpcClient, 'metrics-success')
  ])
  logger.info('Instrumentation setup')

  await core.ready()

  if (core.length === coreLength) {
    logger.info('Found existing core')
  }

  for (let i = core.length; i < coreLength; i++) {
    if (i % 10000 === 0) logger.info(`Added block ${i}`)
    await core.append(b4a.allocUnsafe(blockSizeBytes)) // We don't really care about the block content
  }

  swarm.join(core.discoveryKey, { client: false, server: true })

  const info = await core.info()
  if (info.length !== coreLength) {
    throw new Error(`Logical bug: created core with other length than the expected ${coreLength} (${info.length})`)
  }
  if (info.byteLength !== coreLength * blockSizeBytes) {
    throw new Error(`Logical bug: created core with other byteLength than the expected ${coreLength * blockSizeBytes} (${info.byteLength})`)
  }

  logger.info(`Started serving core of ${formatBytes(info.byteLength)} with ${info.length} blocks of ${formatBytes(blockSizeBytes)}`)
  logger.info(`Public key ${idEnc.normalize(core.key)} (Discovery key: ${idEnc.normalize(core.discoveryKey)})`)
}

main()
