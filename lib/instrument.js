const idEnc = require('hypercore-id-encoding')

function instrument (logger, store, swarm) {
  swarm.on('connection', (conn, peer) => {
    const address = `${conn.rawStream.remoteHost}:${conn.rawStream.remotePort}`
    logger.info(`Opened connection to ${idEnc.normalize(peer.publicKey)} (${address})`)
    conn.on('close', () => {
      logger.info(`Closed connection to ${idEnc.normalize(peer.publicKey)} (${address})`)
    })
  })
}

module.exports = instrument
