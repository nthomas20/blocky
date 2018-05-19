'use strict'

/**
 * Library for managing the blockchain
 * Transactions are single ledger events
 * Blocks consist of multiple transactions
 * @author Nathaniel Thomas <nthomas20@gmail.com>
 */

const ObjectHash = require('node-object-hash')
const queue = require('queue')
const EventEmitter = require('events')

// The queue is the block processor
// Chain commits blocks into the queue for processing
// Blocks can pile up and will get processed and validated in order no matter how far ahead the chain may be in building blocks
class Queue {
  constructor (chain) {
    this._queue = queue({
      concurrency: 1,
      timeout: 5000,
      autostart: true
    })
    this.chain = chain
  }

  async push (block, randomNonce, powHashPrefix) {
    this._queue.push(() => {
      return new Promise(async (resolve, reject) => {
        // Grab the previous hash
        let previousHash = null

        if (block.index > 0) {
          let previousBlock = new Block(this.chain, block.index - 1, 0)
          if (await previousBlock.load() === false) {
            return reject(block.index)
          }

          previousHash = await previousBlock.calculateHash(true)
        }

        await block.build(previousHash, randomNonce, powHashPrefix)

        await block.commit()

        return resolve(block.index)
      })
    })
  }
}

// Each Transaction is a single event
class Transaction {
  constructor (data, timestamp = null) {
    this.data = data
    if (timestamp === null) {
      this.timestamp = new Date() / 1
    } else {
      this.timestamp = timestamp
    }

    this.calculateHash()
  }

  calculateHash () {
    this._hash = new ObjectHash().hash({
      data: this.data,
      timestamp: this.timestamp
    })
  }

  get hash () {
    return this._hash
  }
}

// Each Block is a group of transactions
class Block {
  constructor (chain, index = -9, timestamp = null) {
    this.maxTransactions = 2
    this._index = index
    this._length = 0
    this._hash = null
    this._transactionHashArray = []
    this.previousHash = null
    this._nonce = 0

    if (timestamp === null) {
      this.timestamp = new Date() / 1
    } else {
      this.timestamp = timestamp
    }

    this._metaChain = chain
    this._block = new chain.engine.Block(chain, index)
  }

  async _loadTransactionHashes () {
    try {
      this._transactionHashArray = await this._block.loadTransactionHashes()

      return true
    } catch (err) {
      return false
    }
  }

  async _proofOfWork (powHashPrefix = null) {
    if (powHashPrefix !== null) {
      // Do the work to validate the hash prefix
      while (true) {
        await this.calculateHash()

        if (this.hash.slice(0, powHashPrefix.length) === powHashPrefix) {
          break
        } else {
          // Increase the nonce and rebuild the block hash
          this.nonce = this.nonce + 1
        }
      }
    }
  }

  async add (transaction) {
    try {
      await this._block.addTransactionToBlock(transaction, this.length)

      this._transactionHashArray.push(transaction.hash)
      this._length++

      return true
    } catch (err) {
      return false
    }
  }

  get metaData () {
    return [
      this.index,
      this.hash,
      this.previousHash,
      this.length,
      this.nonce,
      this.timestamp
    ]
  }

  async build (previousHash, nonce, powHashPrefix = null) {
    this.previousHash = previousHash
    this.nonce = nonce

    await this._proofOfWork(powHashPrefix)
  }

  async commit () {
    let success = await this._block.commit(this.metaData)

    return success
  }

  async initialize () {
    let success = await this._block.initialize()

    return success
  }

  async delete () {
    let success = await this._block.delete()

    return success
  }

  async calculateHash (force = false) {
    if (this._block !== null) {
      if (force === true || this._transactionHashArray.length !== this.length) {
        await this._loadTransactionHashes()
      }
    }

    // Don't include the current invalid hash in the data
    let withoutHashMetaData = this.metaData
    withoutHashMetaData.splice(1, 1)

    // Create block hash using block uniques
    this._hash = new ObjectHash().hash(withoutHashMetaData.concat(this._transactionHashArray))

    return this._hash
  }

  get hash () {
    return this._hash
  }

  get index () {
    return this._index
  }

  get length () {
    return this._length
  }

  async load (index) {
    let blockData = await this._block.load()

    if (blockData && blockData['index'] === this.index) {
      this._hash = blockData['hash']
      this.previousHash = blockData['previousHash']
      this._length = blockData['length']
      this.nonce = blockData['nonce']
      this.timestamp = blockData['timestamp']

      await this._loadTransactionHashes()

      return true
    }

    return false
  }

  get nonce () {
    return this._nonce
  }

  set nonce (nonce) {
    this._nonce = nonce
  }
}

// Each Chain is a group of Blocks
class Chain {
  constructor (name, engine, powHashPrefix = 'dab7') {
    this.name = name
    this.powHashPrefix = powHashPrefix
    this.maxRandomNonce = 876348467
    this._transactionPool = []
    this.engine = engine
    this._chain = new this.engine.Chain(name)
    this._eventEmitter = new EventEmitter()
  }

  async _createNewBlock () {
    // Finalize the current block
    if (await this._finalizeBlock() === true) {
      // Replace the current block with a new one
      this.workingBlock = new Block(this, this.workingBlock.index + 1)
      await this.workingBlock.initialize()
    }
  }

  async _finalizeBlock () {
    this.queue.push(this.workingBlock, Math.floor(Math.random() * Math.floor(this.maxRandomNonce)), this.powHashPrefix)

    return true
  }

  async _initializeEvents () {
    // Handle the block queue processing events
    this.queue._queue.on('success', (result, job) => {
      this._eventEmitter.emit('blockCommit', result, job)
    })

    this.queue._queue.on('error', (index, job) => {
      this._eventEmitter.emit('blockCommitError', index)
    })

    this.queue._queue.on('timeout', (result, job) => {
      this._eventEmitter.emit('blockCommitTimeout')
    })

    this.queue._queue.on('end', () => {
      this._eventEmitter.emit('blockCommitsComplete', true)
    })
  }

  async _loadChain (reload = true) {
    // Get the last entry in the block list for previous block
    let finalRow = []

    if (reload === true) {
      finalRow = await this._chain.getLastBlock()
    }

    // Build our current block
    if (finalRow.length > 0) {
      this.workingBlock = new Block(this, finalRow[0].i + 1)
    } else {
      this.workingBlock = new Block(this, 0)
    }

    await this.workingBlock.initialize()

    return true
  }

  async add (transaction) {
    this._transactionPool.push(transaction)

    if (this._transactionPool.length >= this.workingBlock.maxTransactions) {
      for (let t in this._transactionPool) {
        await this.workingBlock.add(this._transactionPool[t])
      }

      // Clear transaction pool and create new block
      this._transactionPool = []
      await this._createNewBlock()
    }

    return true
  }

  async initialize (reload = true) {
    // Assign our queue
    this.queue = new Queue(this)

    // Setup events
    this._initializeEvents()

    await this._chain.initialize(reload)

    await this._loadChain(reload)

    return true
  }

  get length () {
    return this.workingBlock.index + 1
  }

  on (event, callback) {
    this._eventEmitter.on(event, callback)
  }
}

exports.Transaction = Transaction
exports.Block = Block
exports.Chain = Chain
