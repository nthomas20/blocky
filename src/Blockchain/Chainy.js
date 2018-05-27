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
const PeerNode = require('peer-node')

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
   * @param {Object} [options={}] - Configuration options for the Block queue processor. Passed through from Chain BlockQueue options
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
   * @param {Number} randomEntropy - Starting random entropy
   * @param {String} powHashPrefix - Hex string prefix for acceptable proof of work calculation
   */
  async push (block, randomEntropy, powHashPrefix) {
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

        await block.build(previousHash, randomEntropy, powHashPrefix)

        await block.commit()

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
   * @param {String} [from=null] - The origin member of the transaction
   * @param {String} [to=null] - The destination member of the transaction
   * @param {String} [nom=0] - A counter transfer. NOM = Numeric Operation Metric
   * @returns {Object} Transaction Instance
   */
  constructor (data, from = null, to = null, nom = 0, timestamp = null) {
    this.data = data
    if (timestamp === null) {
      this.timestamp = new Date() / 1
    } else {
      this.timestamp = timestamp
    }

    this.from = from
    this.to = to
    this.nom = nom

    if (this.nom > 0 && this.from === null && this.to === null) {
      throw new Error('Cannot transfer noms without valid to/from account IDs')
    } else if (this.from !== null && this._isValidAccount(this.from) === false) {
      throw new Error('Invalid from account ID')
    } else if (this.to !== null && this._isValidAccount(this.to) === false) {
      throw new Error('Invalid to account ID')
    } else if (this.to !== null && this.from === null) {
      throw new Error('Must specify from recipient')
    } else if (this.to === null && this.from !== null) {
      throw new Error('Must specify to recipient')
    } else if (this.to !== null && this.to === this.from) {
      throw new Error('Unable to transact between same account')
    }

    this.calculateHash()
  }

  _isValidAccount (accountID) {
    // Validate the set hash value
    if (accountID.match('[A-Fa-f0-9]{64}')) {
      return true
    }

    return false
  }

  /**
   * Calculate the hash of this Transaction. Must be unique against ALL other transactions within all blocks in the chain
   */
  calculateHash () {
    this._hash = new ObjectHash().hash({
      data: this.data,
      from: this.from,
      to: this.to,
      nom: this.nom,
      timestamp: this.timestamp
    })

    this._familiarHash = new ObjectHash().hash({
      data: this.data,
      from: this.from,
      to: this.to,
      nom: this.nom
    })
  }

  /**
   * Get the hash value of the Transaction
   * @returns {String} Hex hash value for the Transaction
   */
  get hash () {
    return this._hash
  }

  get familiarHash () {
    return this._familiarHash
  }

  get prefix () {
    return this._prefix
  }

  set prefix (prefix) {
    this._prefix = prefix

    this._hash = `${prefix}${this._hash}`
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
    this._transactionFamiliarHashArray = []
    this.previousHash = null
    this._entropy = 0

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
          // Increase the entropy and rebuild the block hash
          this.entropy = this.entropy + 1
        }
      }
    } else {
      await this.calculateHash()
    }
  }

  /**
   * Add a transaction into the Block
   * @param {Object} transaction - Reference to the Transaction Object
   * @param {String} [prefix=''] - Prefix the transaction hash with a short string
   * @returns {Boolean} Status of the add operation
   */
  async add (transaction, prefix = '') {
    try {
      if (prefix !== '') {
        transaction.prefix = prefix
      }

      await this._block.addTransactionToBlock(transaction, this.length)

      this._transactionHashArray.push(transaction.hash)
      this._transactionFamiliarHashArray.push(transaction.familiarHash)
      this._length++

      return true
    } catch (err) {
      return false
    }
  }

  /**
   * Get the block's meta data
   * @returns {Array} Array containing [index, hash, previous hash, length, entropy, timestamp] of the block
   */
  get metaData () {
    return [
      this.index,
      this.hash,
      this.previousHash,
      this.length,
      this.entropy,
      this.timestamp
    ]
  }

  /**
   * Build the block and calculate its final hash
   * @param {String} previousHash - Hash value of the previous block
   * @param {Number} entropy - Numeric entropy value
   * @param {String} [powHashPrefix=null] - Hash prefix to use for proof of work
   */
  async build (previousHash, entropy, powHashPrefix = null) {
    this.previousHash = previousHash
    this.entropy = entropy

    await this._proofOfWork(powHashPrefix)
  }

  /**
   * Commit the block to the chain
   * @returns {Boolean} Status of the commit operation
   */
  async commit () {
    let success = await this._block.commit(this.metaData)

    // Remove transactions in this block from the chain's pending pool
    for (let familiarHash of this._transactionFamiliarHashArray) {
      this._metaChain._pendingPool.splice(this._metaChain._pendingPool.indexOf(familiarHash), 1)
    }

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
      this.entropy = blockData['entropy']
      this.timestamp = blockData['timestamp']

      await this._loadTransactionHashes()

      return true
    }

    return false
  }

  /**
   * Retrieve the entropy of the block
   * @returns {Number} The entropy value of the hash
   */
  get entropy () {
    return this._entropy
  }

  /**
   * Set the entropy of the block
   * @param {Number} entropy - The entropy value of the hash
   */
  set entropy (entropy) {
    this._entropy = entropy
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
   * @param {Object} [options={}] - Configuration options for the Blockchain
   * @param {String} [options.powHashPrefix=null] Proof of Work Prefix value. Default indicates no proof of work necessary
   * @param {Number} [options.maxRandomEntropy=876348467] Maximum number to randomly select for entropy calculation starting point
   * @param {Number} [options.maxBlockTransactions=1000] Maximum number of transactions to include in a block
   * @param {String} [options.transactionPrefix=''] Short string to prefix onto transaction hashes (can help to identify transactions in a sea of hashes)
   * @param {Object} [options.BlockQueue] Configuration options for the Block queue processor
   * @param {Number} [options.BlockQueue.timeout=null] Maximum time to spend processing a block. Default is infinity, this is recommended
   * @param {Boolean} [options.BlockQueue.autostart=true] Automatically start processing the queue when a block is submitted. Value is ignored when participating in peer network
   * @returns {Object} Chain Object Instance
   */
  constructor (name, storage, options = {}) {
    this._name = name

    // Set my defaults
    this.options = Object.assign({
      powHashPrefix: null,
      maxRandomEntropy: 876348467,
      maxBlockTransactions: 1000,
      transactionPrefix: '',
      BlockQueue: {
        autostart: true
      }
    }, options)

    this._transactionPool = []
    this._pendingPool = []
    this.storage = storage
    this._chain = new this.storage.Chain(name)
    this._eventEmitter = new EventEmitter()
    this._length = 0
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
    this.queue.push(this.workingBlock, Math.floor(Math.random() * Math.floor(this.options.maxRandomEntropy)), this.options.powHashPrefix)

    this._eventEmitter.emit('blockSubmit', this.workingBlock.index)

    return true
  }

  async _initializeEvents () {
    // Handle the block queue processing events
    this.queue._queue.on('success', (result, job) => {
      this._length++
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

  _isPendingTransaction (transaction) {
    // Generate sub-hash of transaction to prevent duplicate transactions from being accepted
    return this._pendingPool.includes(transaction.familiarHash)
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

  async _processTransactionPool () {
    let count = 0
    let transaction

    while (this._transactionPool.length > 0 && count < this.options.maxBlockTransactions) {
      transaction = this._transactionPool.shift()

      if (await this.workingBlock.add(transaction, this.options.transactionPrefix) === false) {
        return
      }

      count++
    }

    // Create new block
    await this._createNewBlock()

    return true
  }

  /**
   * Add a transaction into the current working block
   * @param {Object} transaction - Transaction Object to add to the block/chain
   * @returns {Boolean} Status of add operation
   */
  async add (transaction) {
    if (this._isPendingTransaction(transaction) === true) {
      return false
    }

    // Add the transaction
    this._transactionPool.push(transaction)

    // Add the familiar hash to prevent duplicates
    this._pendingPool.push(transaction.familiarHash)

    // If it's time to push transactions into a block, then let's do it!
    if (this._transactionPool.length >= this.options.maxBlockTransactions) {
      await this._processTransactionPool()
    }

    return true
  }

  /**
   * Delete the chain
   */
  delete () {
    // Call the storage engine to delete the chain
    this._chain.delete()
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
    return this._length
  }

  /**
   * Get the name of the chain
   */
  get name () {
    return this._name
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

/**
 * Layer than manages communications to peer nodes with regards to blockchain activities
 * @class
 * @memberof module:Blockchain/Peery
 */
class Peery {
  /**
   *
   * @param {String} name - The name of the chain to which this node will attach
   * @param {String} role - The initial requested role of this node (peer may override if this host does not CREATE a new chain [ 'transact', 'validate', 'observe' ])
   * @param {String} [forkID=null] - Specify an initial forkID. Default of blank will require peer node to specify initial fork
   * @param {Number} [port=6477] - Specify the port on which to connect
   */
  constructor (name, role, primaryForkID = null, port = 6477) {
    this._name = name
    this._role = role
    this._primaryForkID = primaryForkID
    this._port = port

    this._node = new PeerNode.Node(new PeerNode.Host('', this.port))
    this._peers = []
    this._chainForks = {}

    this._eventEmitter = new EventEmitter()
  }

  async _initializeEvents () {
    // Handle the block queue processing events
    this._node.on('peerConnected', (data) => {
      this._eventEmitter.emit('peerConnected', data)
    })

    this._node.on('')
  }

  async connectPeers (peers) {
    for (let peerIP of peers) {
      let peer = new PeerNode.Peer(new PeerNode.Host(peerIP, this.port))

      peer.generateKeypair()

      peer.on('connect', () => {
        this._peers.push(peer)
      })

      peer.connect()
    }
  }

  /**
   * Start node in initial requested node
   */
  async start (initialPeers = []) {
    // Connect to incoming peers
    if (initialPeers.length > 0) {
      await this.connectPeers(initialPeers)
    }

    this._node.listen()
  }

  /**
   * Attach to a peer event
   * @param {String} event - Event string on which to attach
   * @param {Function} callback - Function to execute when event is emitted
   */
  on (event, callback) {
    this._eventEmitter.on(event, callback)
  }

  get primaryForkID () {
    return this._primaryForkID
  }

  get name () {
    return this._name
  }

  get port () {
    return this._port
  }
}

exports.Transaction = Transaction
exports.Block = Block
exports.Chain = Chain
exports.Peery = Peery
