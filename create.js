const idEnc = require('hypercore-id-encoding')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const pino = require('pino')
const b4a = require('b4a')
const formatBytes = require('tiny-byte-size')
const goodbye = require('graceful-goodbye')
const instrument = require('./lib/instrument')

function loadConfig () {
  const coreLength = parseInt(process.env.HYPERCORE_E2E_LENGTH)

  return {
    coreLength,
    corestoreLoc: process.env.HYPERCORE_E2E_CORESTORE_LOC || 'e2e-tests-creator-corestore',
    logLevel: 'info',
    blockSizeBytes: 1000
  }
}

async function main () {
  const config = loadConfig()
  const { corestoreLoc, logLevel, coreLength } = config
  const { blockSizeBytes } = config
  const logger = pino({ level: logLevel })

  const store = new Corestore(corestoreLoc)
  const swarm = new Hyperswarm()
  swarm.on('connection', (conn, peer) => {
    store.replicate(conn)
  })

  instrument(logger, store, swarm)

  const core = store.get({ name: `e2e-test-core-${coreLength}-${blockSizeBytes}` })

  goodbye(async () => {
    try {
      logger.info('Shutting down')
      await swarm.destroy()
      logger.info('swarm shut down')
      await store.close()
    } catch (e) {
      logger.error(`Error while shutting down ${e.stack}`)
    }

    logger.info('Successfully shut down')
  })

  await core.ready()

  logger.info('Starting hypercore-e2e-tests creator')

  if (core.length === coreLength) {
    logger.info('Found existing core')
  }

  for (let i = core.length; i < coreLength; i++) {
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
