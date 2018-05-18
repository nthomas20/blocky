'use strict'

/**
 * Library for managing the blockchain
 * Transactions are single ledger events
 * Blocks consist of multiple transactions
 * @author Nathaniel Thomas <nthomas20@gmail.com>
 */

const ObjectHash = require('node-object-hash')
const sqlite = require('sqlite')

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
  constructor (_chain, index, timestamp = null) {
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

    this._chain = _chain
  }

  async _addTransactionToBlock (transaction) {
    try {
      await this._chain.run(`INSERT INTO block_${this.index} VALUES (?, ?, ?, ?)`, [
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
    try {
      await this._chain.run('INSERT INTO block VALUES (?, ?, ?, ?, ?, ?)', this.array)

      return true
    } catch (err) {
      return false
    }
  }

  async initialize () {
    await this.delete()

    await this._chain.run(`CREATE TABLE block_${this.index} (i INTEGER PRIMARY KEY ASC, hash VARCHAR, timestamp INTEGER, data VARCHAR)`)
    await this._chain.run(`CREATE UNIQUE INDEX idx_b_h_${this.index} ON block_${this.index} (hash)`)
  }

  async delete () {
    await this._chain.run(`DROP TABLE IF EXISTS block_${this.index}`)
    await this._chain.run(`DROP INDEX IF EXISTS idx_b_h_${this.index}`)
  }

  async calculateHash (force = false) {
    if (force === true || this._transactionHashArray.length !== this.length) {
      let hashRows = await this._chain.all(`SELECT i, hash FROM block_${this.index} ORDER BY i ASC`)

      if (hashRows.length > 0) {
        this._transactionHashArray = []
        hashRows.forEach((row, i) => {
          this._transactionHashArray.push(row['hash'])
        })
      }
    }

    // Create block hash using block uniques
    this._hash = new ObjectHash().hash(this.array.concat(this._transactionHashArray))

    return this._hash
  }

  set current (isCurrent) {
    this._current = isCurrent
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
    this.name = name
    this.powHashPrefix = powHashPrefix
    this.maxRandomNonce = 876348467
    this.previousBlock = null
  }

  async _createNewBlock () {
    // Finalize the current block
    if (await this._finalizeBlock() === true) {
      // Set the previous block to the working block
      this.previousBlock = this.workingBlock

      // Replace the current block with a new one
      this.workingBlock = new Block(this._chain, this.workingBlock.index + 1)
      await this.workingBlock.initialize()
    }
  }

  async _finalizeBlock () {
    // Manage against the genesis block which has no actual record
    let previousHash = null

    if (this.previousBlock !== null) {
      previousHash = this.previousBlock.hash
    }

    await this.workingBlock.build(previousHash, Math.floor(Math.random() * Math.floor(this.maxRandomNonce)), this.powHashPrefix)

    // TODO: Validate block as part of the commit
    if (await this.workingBlock.commit() === true) {
      return true
    } else {
      return false
    }
  }

  async _seedChain () {
    // Get the last entry in the block list for previous block
    let finalRow = await this._chain.all('SELECT * FROM block ORDER BY i DESC LIMIT 1')

    if (finalRow.length > 0) {
      this.previousBlock = new Block(this._chain, finalRow[0].i, finalRow[0].previousHash, finalRow[0].timestamp, finalRow[0].nonce)
    }

    // Build our current block
    this.workingBlock = new Block(this._chain, 0, -1)
    await this.workingBlock.initialize()

    return true
  }

  async add (transaction) {
    if (await this.workingBlock.add(transaction) === true) {
      if (this.workingBlock.length >= this.workingBlock.maxTransactions) {
        await this._createNewBlock()
      }

      return true
    }

    return false
  }

  async initialize (seed = true) {
    this._chain = await sqlite.open(`./${this.name}.db`, { Promise })

    // Initialize block table
    await this._chain.run(`CREATE TABLE IF NOT EXISTS block (i INTEGER PRIMARY KEY ASC, hash VARCHAR, previousHash VARCHAR, length INTEGER, nonce INTEGER, timestamp INTEGER)`)
    await this._chain.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_b_h ON block (hash)`)
    await this._chain.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_b_ph ON block (previousHash)`)

    if (seed === true) {
      await this._seedChain()
    }

    return true
  }

  get length () {
    return this.workingBlock.index + 1
  }
}

exports.Transaction = Transaction
exports.Block = Block
exports.Chain = Chain
