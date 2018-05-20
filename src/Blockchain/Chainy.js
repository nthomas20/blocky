'use strict'

/**
 * Library for managing the blockchain
 * Transactions are single ledger events
 * Blocks consist of multiple transactions
 * @author Nathaniel Thomas <nthomas20@gmail.com>
 * @module Blockchain/Chainy
 */

const ObjectHash = require('node-object-hash')
const queue = require('queue')
const EventEmitter = require('events')

// The queue is the block processor
// Chain commits blocks into the queue for processing
// Blocks can pile up and will get processed and validated in order no matter how far ahead the chain may be in building blocks
/**
 * Queue class for ordered block processing
 * @class
 * @memberof module:Blockchain/Chainy
 */
class Queue {
  /**
   * @constructor
   * @param {Object} chain - Reference to the Chain Object
   * @param {Object} [options={}] - Queue Options (timeout=null, autostart=true). If setting autostart=false, you'll have to handle block processing on your own
   * @returns {Object} Queue Instance
   */
  constructor (chain, options = {}) {
    // Never allow concurrency greater than 1
    options['concurrency'] = 1
    this._queue = queue(options)
    this.chain = chain
  }

  /**
   * Push a block on to the Chain queue for ordered processing
   * @param {Object} block - Reference to the Block Object
   * @param {Number} randomNonce - Starting random nonce
   * @param {String} powHashPrefix - Hex string prefix for acceptable proof of work calculation
   */
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

        // Clear the block's transactions from the chain
        delete this.chain._transactionPool[block.index]

        return resolve(block.index)
      })
    })
  }
}

/**
 * Transaction to be pushed into a block for processing
 * @class
 * @memberof module:Blockchain/Chainy
 */
class Transaction {
  /**
   *
   * @param {String} data - Data to be set into the Transaction
   * @param {Number} [timestamp=null] - Number to force timestamp into a transaction. Use with care
   * @returns {Object} Transaction Instance
   */
  constructor (data, origin = null, destination = null, timestamp = null) {
    this.data = data
    if (timestamp === null) {
      this.timestamp = new Date() / 1
    } else {
      this.timestamp = timestamp
    }

    this.origin = origin
    this.destination = destination

    this.calculateHash()
  }

  /**
   * Calculate the hash of this Transaction. Must be unique against ALL other transactions within all blocks in the chain
   */
  calculateHash () {
    this._hash = new ObjectHash().hash({
      data: this.data,
      origin: this.origin,
      destination: this.destination,
      timestamp: this.timestamp
    })
  }

  /**
   * Get the hash value of the Transaction
   * @returns {String} Hex hash value for the Transaction
   */
  get hash () {
    return this._hash
  }
}

/**
 * Block that holds a set of transactions
 * @class
 * @memberof module:Blockchain/Chainy
 */
class Block {
  /**
   *
   * @param {Object} chain - Reference to the Chain Object
   * @param {Number} index - Index of the block to load/create
   * @param {Number} [timestamp=null] - Number to force timestamp into a transaction. Use with care
   * @returns {Object} Block Instance
   */
  constructor (chain, index, timestamp = null) {
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
    this._block = new chain.storage.Block(chain, index)
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
    } else {
      await this.calculateHash()
    }
  }

  /**
   * Add a transaction into the Block
   * @param {Object} transaction - Reference to the Transaction Object
   * @returns {Boolean} Status of the add operation
   */
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

  /**
   * Get the block's meta data
   * @returns {Array} Array containing [index, hash, previous hash, length, nonce, timestamp] of the block
   */
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

  /**
   * Build the block and calculate its final hash
   * @param {String} previousHash - Hash value of the previous block
   * @param {Number} nonce - Numeric nonce value
   * @param {String} [powHashPrefix=null] - Hash prefix to use for proof of work
   */
  async build (previousHash, nonce, powHashPrefix = null) {
    this.previousHash = previousHash
    this.nonce = nonce

    await this._proofOfWork(powHashPrefix)
  }

  /**
   * Commit the block to the chain
   * @returns {Boolean} Status of the commit operation
   */
  async commit () {
    let success = await this._block.commit(this.metaData)

    return success
  }

  /**
   * Initialize the block and empty any previous block data
   * Use with care
   * @returns {Boolean} Status of the initialize operation
   */
  async initialize () {
    let success = await this._block.initialize()

    return success
  }

  /**
   * Delete any existing data within the block
   * Use with care
   * @returns {Boolean} Status of the delete operation
   */
  async delete () {
    let success = await this._block.delete()

    return success
  }

  /**
   * Calculate the hash of this block
   * @param {Boolean} [force=false] Force load transactions from block vs use what's in-memory
   * @returns {String} Hex value of the hash
   */
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

  /**
   * Retrieve the hash for the block
   * @returns {String} Hex value of the hash
   */
  get hash () {
    return this._hash
  }

  /**
   * Retrieve the index for the block
   * @returns {Number} Index value of the hash
   */
  get index () {
    return this._index
  }

  /**
   * Retrieve the length of transactions within the block
   * @returns {Number} Length of transactions in the block
   */
  get length () {
    return this._length
  }

  /**
   * Load a block from the chain
   * @param {Number} index - Index of the block to load
   * @returns {Boolean} Status of the load operation
   */
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

  /**
   * Retrieve the nonce of the block
   * @returns {Number} The nonce value of the hash
   */
  get nonce () {
    return this._nonce
  }

  /**
   * Set the nonce of the block
   * @param {Number} nonce - The nonce value of the hash
   */
  set nonce (nonce) {
    this._nonce = nonce
  }
}

/**
 * Chain that manages blocks and transactions
 * @class
 * @memberof module:Blockchain/Chainy
 */
class Chain {
  /**
   * @constructor
   * @param {String} name - Path and name of the chain
   * @param {Object} storage - Storage Module (do not instantiate)
   * @param {Object} [options={}] - Options for the chain (powHashPrefix, maxRandomNonce, maxBlockTransactions, BlockQueue = (timeout, autostart))
   * @returns {Object} Chain Object Instance
   */
  constructor (name, storage, options = {}) {
    this.name = name

    // Set my defaults
    this.options = Object.assign({
      powHashPrefix: null,
      maxRandomNonce: 876348467,
      maxBlockTransactions: 1000,
      BlockQueue: {
        autostart: true
      }
    }, options)

    this._transactionPool = {}
    this.storage = storage
    this._chain = new this.storage.Chain(name)
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
    this.queue.push(this.workingBlock, Math.floor(Math.random() * Math.floor(this.options.maxRandomNonce)), this.options.powHashPrefix)

    this._eventEmitter.emit('blockSubmit', this.workingBlock.index)

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
      this._eventEmitter.emit('blockCommitQueueEmpty', true)
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

  /**
   * Add a transaction into the current working block
   * @param {Object} transaction - Transaction Object to add to the block/chain
   * @returns {Boolean} Status of add operation
   */
  async add (transaction) {
    if (this._transactionPool.hasOwnProperty(this.workingBlock.index) === false) {
      this._transactionPool[this.workingBlock.index] = []
    }

    // Add the transaction
    this._transactionPool[this.workingBlock.index].push(transaction)

    // If it's time to push transactions into a block, then let's do it!
    if (this._transactionPool[this.workingBlock.index].length >= this.options.maxBlockTransactions) {
      for (let t in this._transactionPool[this.workingBlock.index]) {
        if (await this.workingBlock.add(this._transactionPool[this.workingBlock.index][t]) === false) {
          return false
        }
      }

      // Clear transaction pool and create new block
      await this._createNewBlock()
    }

    return true
  }

  /**
   * Initialize the chain
   * @param {Boolean} [reload=true] Reload an existing chain. Set to false to clear and start fresh
   * @returns {Boolean} Status of initialization
   */
  async initialize (reload = true) {
    // Assign our queue
    this.queue = new Queue(this, this.options.BlockQueue)

    // Setup events
    this._initializeEvents()

    await this._chain.initialize(reload)

    await this._loadChain(reload)

    return true
  }

  async findTransactionByHash (transactionHash) {
    let transactionInfo = await this._chain.findTransactionByHash(transactionHash)

    return transactionInfo
  }

  async findTransactionByAuthor (author, startPOS = 0, limit = 500) {
    let transactionInfo = await this._chain.findTransactionByAuthor(author, startPOS, limit)

    return transactionInfo
  }

  /**
   * Retrieve the length of the chain. How many committed blocks does not include working block
   * @returns {Number} Length of the chain
   */
  get length () {
    return this.workingBlock.index
  }

  /**
   * Attach to a chain event
   * @param {String} event - Event string on which to attach
   * @param {Function} callback - Function to execute when event is emitted
   */
  on (event, callback) {
    this._eventEmitter.on(event, callback)
  }
}

exports.Transaction = Transaction
exports.Block = Block
exports.Chain = Chain
