const fsProm = require('fs').promises
const { tmpdir } = require('node:os')
const path = require('path')
const idEnc = require('hypercore-id-encoding')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const pino = require('pino')
const goodbye = require('graceful-goodbye')
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

  return {
    key,
    coreLength,
    logLevel: 'info'
  }
}

async function main () {
  const { key, logLevel, coreLength } = loadConfig()

  const logger = pino({ level: logLevel })

  const corestoreLoc = await fsProm.mkdtemp(
    path.join(tmpdir(), 'hypercore-e2e-corestore-')
  )
  logger.info(`Using Corestore location ${corestoreLoc}`)
  const store = new Corestore(corestoreLoc)

  const swarm = new Hyperswarm()
  swarm.on('connection', (conn) => {
    store.replicate(conn)
  })

  instrument(logger, store, swarm)

  const core = store.get({ key })
  core.on('append', () => {
    logger.info(`core updated (length: ${core.length})`)
    if (core.length > coreLength) {
      logger.error(`Core grew past the expected length of ${coreLength} (current length: ${core.length})`)
      process.exit(1)
    }
  })
  core.on('download', () => {
    if (core.contiguousLength === coreLength) {
      logger.info('Core fully downloaded')
    }
  })

  goodbye(async () => {
    try {
      logger.info('Shutting down')
      await swarm.destroy()
      logger.info('swarm shut down')
      await store.close()
      await fsProm.rm(corestoreLoc, { recursive: true })
    } catch (e) {
      logger.error(`Error while shutting down ${e.stack}`)
    }

    logger.info('Successfully shut down')
  })

  await core.ready()

  logger.info(`Starting hypercore-e2e-tests downloader for public key ${idEnc.normalize(core.key)} (Discovery key: ${idEnc.normalize(core.discoveryKey)})`)

  swarm.join(core.discoveryKey, { client: true, server: false })

  if (core.length !== 0) {
    throw new Error('Logical error: did not start with a fresh storage')
  }
  core.download({ start: 0, end: -1 })
}

main()
