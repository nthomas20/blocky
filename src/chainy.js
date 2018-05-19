'use strict'

/**
 * Library for managing the blockchain
 * Transactions are single ledger events
 * Blocks consist of multiple transactions
 * @author Nathaniel Thomas <nthomas20@gmail.com>
 */

const ObjectHash = require('node-object-hash')
const sqlite = require('sqlite')
const queue = require('queue')
const fs = require('fs')
const path = require('path')

// The queue is the block processor
// Chain commits blocks into the queue for processing
// Blocks can pile up and will get processed and validated in order no matter how far ahead the chain may be in building blocks
class Queue {
  constructor (chain) {
    this._queue = queue({
      concurrency: 1,
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
          let previousBlock = new Block(this.chain)
          await previousBlock.load(block.index - 1)
          previousHash = await previousBlock.calculateHash(true)
        }

        await block.build(previousHash, randomNonce, powHashPrefix)

        await block.commit()

        return resolve(true)
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
    this._block = null
  }

  async _addTransactionToBlock (transaction) {
    try {
      await this._block.run(`INSERT INTO block_${this.index} VALUES (?, ?, ?, ?)`, [
        this.length,
        transaction.hash,
        transaction.timestamp,
        JSON.stringify(transaction.data)
      ])

      this._transactionHashArray.push(transaction.hash)
      this._length++

      return true
    } catch (err) {
      return false
    }
  }

  async _loadTransactionHashes () {
    if (this._block !== null) {
      let hashRows = await this._block.all(`SELECT i, hash FROM block_${this.index} ORDER BY i ASC`)

      if (hashRows.length > 0) {
        this._transactionHashArray = []
        hashRows.forEach((row, i) => {
          this._transactionHashArray.push(row['hash'])
        })
      }
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
    let success = await this._addTransactionToBlock(transaction)

    return success
  }

  get array () {
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
    // Check if block is the current working block
    try {
      await this._metaChain._chain.run('INSERT INTO block VALUES (?, ?, ?, ?, ?, ?)', this.array)

      for (let t in this._transactionHashArray) {
        await this._metaChain._transIDX.run('INSERT INTO trans VALUES (?, ?)', [this._transactionHashArray[t], this.index])
      }

      await this._block.close(true)

      return true
    } catch (err) {
      console.error(err)
      return false
    }
  }

  async initialize () {
    if (this._block === null) {
      this._block = await sqlite.open(`${this._metaChain.path}/b_${this._metaChain.name}_${this.index}.db`, { Promise })

      await this.delete()

      await this._block.run(`CREATE TABLE IF NOT EXISTS block_${this.index} (i INTEGER PRIMARY KEY ASC, hash VARCHAR, timestamp INTEGER, data VARCHAR)`)
      await this._block.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_b_h_${this.index} ON block_${this.index} (hash)`)
    }
  }

  async delete () {
    if (this._block !== null) {
      await this._block.run(`DROP TABLE IF EXISTS block_${this.index}`)
      await this._block.run(`DROP INDEX IF EXISTS idx_b_h_${this.index}`)
    }
  }

  async calculateHash (force = false) {
    if (this._block !== null) {
      if (force === true || this._transactionHashArray.length !== this.length) {
        await this._loadTransactionHashes()
      }
    }

    // Create block hash using block uniques
    this._hash = new ObjectHash().hash(this.array.concat(this._transactionHashArray))

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

  async load (i) {
    let blockData = await this._metaChain._chain.all('SELECT * FROM block WHERE i = ? LIMIT 1', [i])

    if (blockData) {
      this._index = i
      this._hash = blockData[0]['hash']
      this.previousHash = blockData[0]['previousHash']
      this._length = blockData[0]['length']
      this.nonce = blockData[0]['nonce']
      this.timestamp = blockData[0]['timestamp']

      await this._loadTransactionHashes()
    }
  }

  get nonce () {
    return this._nonce
  }

  set nonce (nonce) {
    this._nonce = nonce

    this.calculateHash()
  }
}

// Each Chain is a group of Blocks
class Chain {
  constructor (name, powHashPrefix = 'dab7') {
    this.path = path.dirname(name)
    this.name = path.basename(name)
    this.powHashPrefix = powHashPrefix
    this.maxRandomNonce = 876348467
    this._transactionPool = []
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

  async _loadChain (reload = true) {
    // Get the last entry in the block list for previous block
    let finalRow = []

    if (reload === true) {
      finalRow = await this._chain.all('SELECT i FROM block ORDER BY i DESC LIMIT 1')
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

    if (reload === false) {
      // Clear out the chain's data files
      if (fs.existsSync(this.path)) {
        fs.readdirSync(this.path).forEach((file, index) => {
          if (file.indexOf(this.name) !== -1) {
            fs.unlinkSync(path.join(this.path, file))
          }
        })
      }
    }

    this._chain = await sqlite.open(`${this.path}/${this.name}.db`, { Promise })
    this._transIDX = await sqlite.open(`${this.path}/${this.name}.t.idx.db`, { Promise })

    // Initialize block table
    await this._chain.run(`CREATE TABLE IF NOT EXISTS block (i INTEGER PRIMARY KEY ASC, hash VARCHAR, previousHash VARCHAR, length INTEGER, nonce INTEGER, timestamp INTEGER)`)
    await this._chain.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_b_h ON block (hash)`)
    await this._chain.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_b_ph ON block (previousHash)`)

    await this._transIDX.run(`CREATE TABLE IF NOT EXISTS trans (hash VARCHAR PRIMARY KEY, i INTEGER)`)

    await this._loadChain(reload)

    return true
  }

  get length () {
    return this.workingBlock.index + 1
  }
}

exports.Transaction = Transaction
exports.Block = Block
exports.Chain = Chain
