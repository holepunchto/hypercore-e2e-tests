const os = require('os')
const fsProm = require('fs').promises
const { once } = require('events')
const path = require('path')
const idEnc = require('hypercore-id-encoding')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const pino = require('pino')
const goodbye = require('graceful-goodbye')
const promClient = require('prom-client')
const formatBytes = require('tiny-byte-size')
const replSwarm = require('repl-swarm')
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

  if (process.env.HYPERCORE_E2E_BYTE_LENGTH === undefined) {
    console.error('HYPERCORE_E2E_BYTE_LENGTH must be set to the byte length of the hypercore, as a sanity check')
    process.exit(1)
  }
  const coreByteLength = parseInt(process.env.HYPERCORE_E2E_BYTE_LENGTH)

  const config = {
    key,
    coreLength,
    coreByteLength,
    logLevel: process.env.HYPERCORE_E2E_LOG_LEVEL || 'info',
    exposeRepl: process.env.HYPERCORE_E2E_REPL === 'true'
  }

  config.prometheusServiceName = 'hypercore-e2e-tests'
  config.prometheusAlias = process.env.HYPERCORE_E2E_PROMETHEUS_ALIAS || `hypercore-e2e-download-${formatBytes(coreByteLength)}-${os.hostname()}`.replace(' ', '-')

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
  const { key, logLevel, coreLength, coreByteLength } = config
  const {
    prometheusScraperPublicKey,
    prometheusAlias,
    prometheusSecret,
    prometheusServiceName,
    exposeRepl
  } = config

  const logger = pino({ level: logLevel })
  logger.info(`Starting hypercore-e2e-tests downloader for public key ${idEnc.normalize(key)}`)

  const corestoreLoc = await fsProm.mkdtemp(
    path.join(os.tmpdir(), 'hypercore-e2e-corestore-')
  )
  logger.info(`Using Corestore location ${corestoreLoc}`)
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

  if (exposeRepl === true) {
    const replKey = replSwarm({ core, store, swarm, promRpcClient })
    logger.warn(`Exposed repl swarm at key ${replKey} (core, store, swarm and promRpcClient)`)
  }

  goodbye(async () => {
    try {
      logger.info('Shutting down')
      await promRpcClient.close()
      logger.info('Prom-rpc client shut down')
      await swarm.destroy()
      logger.info('swarm shut down')
      await store.close()
      await fsProm.rm(corestoreLoc, { recursive: true })
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

  swarm.join(core.discoveryKey, { client: true, server: false })

  if (core.length !== 0) {
    throw new Error('Logical error: did not start with a fresh storage')
  }
  core.download({ start: 0, end: -1 })

  logger.info('Downloading core')
}

main()
