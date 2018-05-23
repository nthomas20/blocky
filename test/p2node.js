'use strict'

const p2p = require('../src/Network/P2P')
const {promisify} = require('util')

async function run () {
  let Node = new p2p.Node(new p2p.Host('localhost', 3000))

  Node.on('peerConnected', (data) => {
    console.log('Peer connected', data.peerHash)
  })

  setTimeout(() => {
    console.log('sending broadcast')
    Node.broadcast('NOM', 'I wish to allocate you 300 noms, everybody gets 300 noms!!!')
  }, 10000)

  await Node.listen()
}

let runAsync = promisify(run)

runAsync()
