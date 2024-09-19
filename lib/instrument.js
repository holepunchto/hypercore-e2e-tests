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
  promRpcClient.registerLogger(logger)

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
