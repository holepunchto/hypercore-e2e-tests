const idEnc = require('hypercore-id-encoding')
const DhtPromClient = require('dht-prom-client')
const HyperswarmStats = require('hyperswarm-stats')
const HyperDht = require('hyperdht')
const HypercoreStats = require('hypercore-stats')

const { version: PACKAGE_VERSION } = require('../package.json')

function instrument (logger, store, swarm, {
  promClient,
  prometheusScraperPublicKey,
  prometheusAlias,
  prometheusSecret,
  prometheusServiceName
}) {
  swarm.on('connection', (conn, peer) => {
    const address = `${conn.rawStream.remoteHost}:${conn.rawStream.remotePort}`
    logger.info(`Opened connection to ${idEnc.normalize(peer.publicKey)} (${address})`)
    conn.on('close', () => {
      logger.info(`Closed connection to ${idEnc.normalize(peer.publicKey)} (${address})`)
    })
  })

  promClient.collectDefaultMetrics()

  const swarmStats = new HyperswarmStats(swarm)
  swarmStats.registerPrometheusMetrics(promClient)

  const hypercoreStats = HypercoreStats.fromCorestore(store)
  hypercoreStats.registerPrometheusMetrics(promClient)

  registerPackageVersion(promClient)

  const dht = new HyperDht()
  const promRpcClient = new DhtPromClient(
    dht,
    promClient,
    prometheusScraperPublicKey,
    prometheusAlias,
    prometheusSecret,
    prometheusServiceName
  )

  setupPromRpcClientLogging(promRpcClient, logger)

  return promRpcClient
}

function registerPackageVersion (promClient) {
  // Gauges expect a number, so we set the version as label instead
  return new promClient.Gauge({
    name: 'package_version',
    help: 'Package version in config.json',
    labelNames: ['version'],
    collect () {
      this.labels(
        PACKAGE_VERSION
      ).set(1)
    }
  })
}

function setupPromRpcClientLogging (client, logger) {
  client.on('register-alias-success', ({ updated }) => {
    logger.info(`Prom client successfully registered alias ${client.alias} (updated: ${updated})`)
  })
  client.on('register-alias-error', (error) => {
    logger.info(`Prom client failed to register alias ${error.stack}`)
  })

  client.on('connection-open', ({ uid, remotePublicKey }) => {
    logger.info(`Prom client opened connection to ${idEnc.normalize(remotePublicKey)} (uid: ${uid})`)
  })
  client.on('connection-close', ({ uid, remotePublicKey }) => {
    logger.info(`Prom client closed connection to ${idEnc.normalize(remotePublicKey)} (uid: ${uid})`)
  })
  client.on('connection-error', ({ error, uid, remotePublicKey }) => {
    logger.info(`Prom client error on connection to ${idEnc.normalize(remotePublicKey)}: ${error.stack} (uid: ${uid})`)
  })
  // TODO: probably rename socket-error to connection-error upstream, and add a connection-close

  client.on('metrics-request', ({ uid, remotePublicKey }) => {
    logger.debug(`Prom client received metrics request from ${idEnc.normalize(remotePublicKey)} (uid: ${uid})`)
  })
  client.on('metrics-error', ({ uid, error }) => {
    logger.info(`Prom client failed to process metrics request: ${error} (uid: ${uid})`)
  })
  client.on('metrics-success', ({ uid }) => {
    logger.debug(`Prom client successfully processed metrics request (uid: ${uid})`)
  })
}

module.exports = instrument
