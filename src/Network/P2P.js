'use strict'

// https://github.com/cryptocoinjs/p2p-node
// https://www.npmjs.com/package/promise-socket

const crypto = require('crypto')
const net = require('net')
const PromiseSocket = require('promise-socket')
const EventEmitter = require('events')

class Host {
  constructor (address, port = 5744) {
    // Accept a few shortcuts for local host
    if (address.includes(['localhost'])) {
      address = '127.0.0.1'
    }

    let version = net.isIP(address)

    // Check family
    if (version === 0) {
      throw new Error('Unknown address family')
    } else {
      this._family = `IPv${version}`
    }

    this._address = address
    this._port = port
  }

  get address () {
    return this._address
  }

  get port () {
    return this._port
  }

  get family () {
    return this._family
  }

  get object () {
    return {
      address: this.address,
      family: this.family,
      port: this.port
    }
  }
}

class Peer {
  constructor (host, header = 0xA27CC1A2, bufferSize = 10485760) {
    this._host = host
    this._state = null
    this._header = header
    this._bufferSize = bufferSize
    this._socket = null
    this._hash = null
    this._connectionAttempts = 0

    this._eventEmitter = new EventEmitter()
  }

  _calculateChecksum (command, data = null) {
    return crypto.createHmac('sha256', command).update(data).digest('hex')
  }

  _socketEventConnect () {
    this._state = 'connected'
    this._connectionAttempts = 0
    this._eventEmitter.emit('connect', {
      peer: this
    })
  }

  _socketEventData (data) {
    // Add data to incoming buffer
    if (data.length + this._inCursor > this._inBuffer.length) {
      this._eventEmitter.emit('error', { peer: this, 'err': 'Peer exceeded max receiving buffer' })
      this._inCursor = this._inBuffer.length + 1
      return
    }

    data.copy(this._inBuffer, this._inCursor)
    this._inCursor += data.length

    // Only process incoming buffer when we have 20 bytes or more
    if (this._inCursor < 20) return

    // Split on header to sparate messages
    let cursor = 0
    let messageEnd = 0

    while (cursor < this._inCursor) {
      // Look for start of a message
      if (this._inBuffer.readUInt32LE(cursor) === this._header) {
        let messageStart = cursor
        if (this._inCursor > messageStart + 16) {
          let messageLength = this._inBuffer.readUInt32LE(messageStart + 16)

          if (this._inCursor >= messageStart + messageLength + 24) {
            // Complete message, let's parse it
            this._processMessage(this._inBuffer.slice(messageStart, messageStart + messageLength + 24))
            messageEnd = messageStart + messageLength + 24
          }
          // Move to the next message
          cursor += messageLength + 24
        } else {
          // Move to the end of processable data
          cursor = this._inCursor
        }
      } else {
        cursor++
      }
    }

    // Remove processed message from the buffer
    if (messageEnd > 0) {
      this._inBuffer.copy(this._inBuffer, 0, messageEnd, this._inCursor)
      this._inCursor -= messageEnd
    }
  }

  _socketEventEnd () {
    this._eventEmitter.emit('end', { peer: this })
  }

  _socketEventError (err) {
    if (this.state === 'connecting') {
      this._connectionAttempts++

      // Reset the socket to try again
      this._socket = null

      this.connect()
    }

    if (this.state !== 'connecting' || this._connectionAttempts === 10) {
      this._eventEmitter.emit('error', { peer: this, err: err })
    }
  }

  _socketEventClose (err) {
    this._state = 'closed'
    this._eventEmitter.emit('close', { peer: this, err: err })
  }

  connect (socket = null) {
    this._inBuffer = Buffer.alloc(this._bufferSize)
    this._inCursor = 0

    if (this._socket === null) {
      if (socket === null) {
        console.debug('Creating new outgoing connection...')
        this._state = 'connecting'
        socket = net.createConnection(this._host.port, this._host.address, this._socketEventConnect.bind(this))
      } else {
        this._state = 'connected'
        console.debug('Using provided existing socket connection...')
      }

      socket.on('data', this._socketEventData.bind(this))
      socket.on('error', this._socketEventError.bind(this))

      this._socket = new PromiseSocket(socket)
    }

    return this._socket
  }

  get connectionAttempts () {
    return this._connectionAttempts
  }

  async disconnect () {
    this._state = 'disconnecting'
    await this._socket.end()
    this._socketEventClose()
  }

  async destroy () {
    this._state = 'destroying'
    await this._socket.destroy()
    this._socketEventClose()
  }

  get hash () {
    return this._hash
  }

  set hash (hash) {
    this._hash = hash
  }

  _processMessage (message) {
    let messageLength = message.readUInt32LE(16)

    // Get command
    let command = []
    for (let i = 0; i < 12; i++) {
      let s = message[i + 4]
      if (s > 0) {
        command.push(String.fromCharCode(s))
      }
    }
    command = command.join('')

    let checksum = message.readUInt32BE(20)
    let payload

    if (messageLength > 0) {
      payload = Buffer.alloc(messageLength)
      message.copy(payload, 0, 24)
      let checksumVerification = Buffer.from(this._calculateChecksum(command, payload))

      // Check the checksum for verification
      if (checksum !== checksumVerification.readUInt32BE(0)) {
        // Do not process a valid message
        payload = null
      }
    } else {
      payload = Buffer.alloc(0)
    }

    if (payload !== null) {
      this._eventEmitter.emit('message', {
        peer: this,
        command: command,
        data: payload
      })
    }
  }

  /**
   * Attach to a peer event
   * @param {String} event - Event string on which to attach
   * @param {Function} callback - Function to execute when event is emitted
   */
  on (event, callback) {
    this._eventEmitter.on(event, callback)
  }

  async send (command, data = null) {
    if (data === null) {
      data = Buffer.alloc(0)
    } else {
      data = Buffer.from(data)
    }

    let out = Buffer.alloc(data.length + 24)
    // Write out the message header
    out.writeUInt32LE(this._header, 0)

    // Loop through our command characters and write up to 12 of them
    for (let i = 0; i < 12; i++) {
      let charCode = 0

      if (i < command.length) {
        charCode = command.charCodeAt(i)
      }

      out.writeUInt8(charCode, i + 4)
    }

    // Output the length of the data block
    out.writeUInt32LE(data.length, 16)

    // Generate our checksum for this message
    let checksum = Buffer.from(this._calculateChecksum(command, data))

    // Copy our checksum and data into the outgoing buffer
    checksum.copy(out, 20)
    data.copy(out, 24)

    try {
      await this._socket.write(out, null)

      return true
    } catch (err) {
      console.error(err)
      return false
    }
  }

  get state () {
    return this._state
  }
}

class Node {
  constructor (host, header = 0xA27CC1A2, bufferSize = 10485760) {
    this._host = host
    this._header = header
    this._bufferSize = bufferSize

    this._server = null

    this._peerList = {}

    this._eventEmitter = new EventEmitter()
  }

  _peerConnection (socket) {
    // Here is the processing for when a connection is made in
    let peerHash = crypto.createHash('md5').update((new Date() / 1).toString()).digest('hex')

    let remoteHost = socket.address()

    let peer = new Peer(new Host(remoteHost.address, remoteHost.port))
    peer.hash = peerHash

    this._peerList[peerHash] = peer

    peer.connect(socket)

    peer.on('message', (data) => {
      // Forward this peer's message on to the Node server itself and its listeners
      this._eventEmitter('message', data)
    })

    peer.on('end', () => {
      // Just delete the peer connection, it will reconnect if it wants to
      delete this._peerList[peerHash]
    })

    peer.on('error', () => {
      // Just delete the peer connection, it will reconnect if it wants to
      delete this._peerList[peerHash]
    })

    this._eventEmitter.emit('peerConnected', {
      peer: peer,
      peerHash: peerHash,
      remoteHost: remoteHost
    })
  }

  broadcast (command, data) {
    console.log(this._peerList)

    if (Object.keys(this._peerList).length > 0) {
      for (let peerHash in this._peerList) {
        console.log(peerHash)
        this._peerList[peerHash].send(command, data)
      }
    }
  }

  listen () {
    this._state = 'connecting'
    this._inBuffer = Buffer.alloc(this._bufferSize)
    this._inCursor = 0

    if (this._server === null) {
      this._server = net.createServer(this._peerConnection.bind(this))

      this._server.listen(this._host.port, () => {
        console.log('I am now listening...')
      })
    }

    return this._socket
  }

  /**
   * Attach to a peer event
   * @param {String} event - Event string on which to attach
   * @param {Function} callback - Function to execute when event is emitted
   */
  on (event, callback) {
    this._eventEmitter.on(event, callback)
  }

  get port () {
    return this._port
  }
}

exports.Host = Host
exports.Peer = Peer
exports.Node = Node
