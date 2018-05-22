'use strict'

const p2p = require('../src/Network/P2P')
const {promisify} = require('util')

async function run () {
  let Peer = new p2p.Peer(new p2p.Host('localhost', 3000))

  console.log(Peer)

  await Peer.connect()
}

let runAsync = promisify(run)

runAsync()
