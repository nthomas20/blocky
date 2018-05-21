'use strict'

// https://github.com/cryptocoinjs/p2p-node
// https://www.npmjs.com/package/promise-socket

const EventEmitter = require('events')

class Host {
  constructor (host, port) {
    this._host = host
    this._port = port
  }

  get host () {
    return this._host
  }

  get port () {
    return this._port
  }
}

class Peer extends EventEmitter {
  constructor (host, header = 0xA27CC1A2, bufferSize = 10485760) {
    this._state = null
    this._header = header
    this._bufferSize = bufferSize
    this._socket = null
  }

  _calculateChecksum (message) {}

  _socketEventConnect () {
    this._state = 'connected'
    this.emit('connect', {
      peer: this
    })
  }

  _socketEventData (data) {
    // Add data to incoming buffer
    if (data.length + this._inCursor > this._inBuffer.length) {
      this.emit('error', { peer: this, 'err': 'Peer exceeded max receiving buffer' })
      this._inCursor = this._inBuffer.length + 1
      return;
    }

    data.copy(this._inBuffer, this._inCursor)
    this._inCursor += data.length;

    // Only process incoming buffer when we have 20 bytes or more
    if (this._inCursor < 20) return

    // Split on header to sparate messages
    let cursor = 0, messageEnd = 0

    while (cursor < this._inCursor) {
      // Look for start of a message
      if (this._inBuffer.readUInt32LE(cursor) === this._header) {

        let messageStart = cursor
        if (this._inCursor > messageStart + 16) {
          let messageLength = this._inBuffer.readUInt32LE(messageStart + 16)

          if (this._inCursor >= messageStart + messageLength + 24) {
            // Complete message; parse it
            this.handleMessage(this._inBuffer.slice(messageStart, messageStart + messageLength + 24))
            messageEnd = messageStart + messageLength + 24
          }
          // Move to the next message
          cursorc += messageLength + 24
        } else {
           // Move to the end of processable data
          cursor = this._inCursor
        }
      } else {
        i++;
      }
    }

    // Remove processed message from the buffer
    if (messageEnd > 0) {
      this._inBuffer.copy(this._inBuffer, 0, messageEnd, this._inCursor)
      this._inCursor -= messageEnd
    }
  }

  _socketEventEnd () {
    this.emit('end', { peer: this })
  }

  _socketEventError (err) {
    this.emit('error', { peer: this, err: err })
  }

  _socketEventClose (err) {
    this._state = 'closed'
    this.emit('close', { peer: this, err: err })
  }

  connect () {
    this._state = 'connecting'
    this._inBuffer = new Buffer(this._bufferSize)
    this._inCursor = 0

    if (this._socket === null) {
      this._socket = net.createConnection(this.host.port, this.host.host, this._socketEventConnect)
    }

    this._socket.on('data', this._socketEventData)
    this._socket.on('end', this._socketEventEnd)
    this._socket.on('error', this._socketEventError)
    this._socket.on('close', this._socketEventClose)

    return this.socket
  }

  disconnect () {
    this._state = 'disconnecting'
    this._socket.end()
  }

  destroy () {
    this._state = 'destroying'
    this._socket.destroy()
  }

  async send (command, data = null) {
    if (data === null) {
      data = new Buffer(0)
    } else if (Array.isArray(data)) {
      data = new Buffer(data)
    }

    let out = new Buffer(data.length + 24)
    // Write out the message header
    out.writeUInt32LE(this._header, 0)

    // Loop through our command characters and write up to 12 of them
    for (let i = 0; i < 12; i++) {
      let charCode = 0

      if (i < command.length) command.charCodeAt(i)

      out.writeUInt8(charCode, 4 + i)
    }

    // Output the length of the data block
    out.writeUInt32LE(data.length, 16)

    // Generate our checksum for this message
    let checksum = this._calculateChecksum(data)
    checksum.copy(out, 20)
    data.copy(out, 24)

    this._socket.write(out, null, callback)
  }

  get state () {
    return this._state
  }
}

exports.Peer = Peer
