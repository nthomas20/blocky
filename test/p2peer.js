'use strict'

const p2p = require('../src/Network/P2P')
const {promisify} = require('util')

async function run () {
  let Peer = new p2p.Peer(new p2p.Host('127.0.0.1', 3000))

  Peer.generateKeypair()

  Peer.on('connect', () => {
    console.log('CONNECTED!')
  })

  Peer.on('message', (payload) => {
    console.log(payload.data.toString())
  })

  await Peer.connect()
}

let runAsync = promisify(run)

runAsync()
