'use strict'

/**
 * SQLite engine for chain management
 * @author Nathaniel Thomas <nthomas20@gmail.com>
 * @module Storage/SQLite
 */

const sqlite = require('sqlite')
const fs = require('fs')
const path = require('path')

/**
 * Manage Block Storage to SQLite
 * @class
 * @memberof module:Storage/SQLite
 */
class Block {
  /**
   * @constructor
   * @param {Object} chain - Reference to Chain Object
   * @param {Number} index - Index number of block
   */
  constructor (chain, index) {
    this.path = path.dirname(chain.name)
    this.name = path.basename(chain.name)
    this.index = index
    this._chain = chain
    this._block = null
  }

  /**
   * Store Transaction into a Block
   * @param {Object} transaction - Reference to Transaction Object
   * @param {Number} length - Current length of Block
   * @returns {Boolean} Status of add operation
   */
  async addTransactionToBlock (transaction, length) {
    if (this._block !== null) {
      try {
        await this._block.run(`INSERT INTO block_${this.index} VALUES (?, ?, ?, ?, ?, ?, ?)`, [
          length,
          transaction.hash, transaction.from, transaction.to,
          transaction.nom,
          transaction.timestamp,
          JSON.stringify(transaction.data)
        ])
      } catch (err) {
        console.error(err)
        return false
      }

      return true
    }

    return false
  }

  /**
   * Close the storage for the block
   */
  async close () {
    if (this._block !== null) {
      await this._block.close(true)
    }
  }

  /**
   * Commit a block into the chain and close the storage
   * @param {Array} metaData - Array of metadata about the block
   * @returns {Boolean} Status of commit operation
   */
  async commit (metaData) {
    // Check if block is the current working block
    try {
      await this._chain._chain._chain.run('INSERT INTO block VALUES (?, ?, ?, ?, ?, ?)', metaData)

      let hashArray = await this.loadTransactionHashes(true)

      for (let t in hashArray) {
        let from = hashArray[t]['from']
        let to = hashArray[t]['to']
        let nom = hashArray[t]['nom']

        await this._chain._chain._transIDX.run('INSERT INTO trans VALUES (?, ?, ?, ?, ?, ?)', [hashArray[t]['hash'], from, to, nom, this.index, t])
        await this._chain._chain._memberFIDX.run('INSERT INTO member VALUES (?, ?, ?, ?, ?)', [hashArray[t]['hash'], from, to, nom, this.index])
        await this._chain._chain._memberTIDX.run('INSERT INTO member VALUES (?, ?, ?, ?, ?)', [hashArray[t]['hash'], from, to, nom, this.index])
      }

      await this.close()

      return true
    } catch (err) {
      return false
    }
  }

  /**
   * Delete a block
   * Use with care
   * @returns {Boolean} Status of delete operation
   */
  async delete () {
    if (this._block !== null) {
      try {
        await this._block.run(`DROP TABLE IF EXISTS block_${this.index}`)
        await this._block.run(`DROP INDEX IF EXISTS idx_b_h_${this.index}`)
      } catch (err) {
        return false
      }
    }

    return true
  }

  /**
   * Initialize the block for storage. Will delete previous block data
   * Use with care
   * @returns {Boolean} Status of initialization
   */
  async initialize () {
    if (this._block === null) {
      try {
        await this.open()

        await this.delete()

        await this._block.run(`CREATE TABLE block_${this.index} (i INTEGER PRIMARY KEY ASC, hash VARCHAR, f VARCHAR, t VARCHAR, nom FLOAT, timestamp INTEGER, data VARCHAR)`)
        await this._block.run(`CREATE UNIQUE INDEX idx_b_h_${this.index} ON block_${this.index} (hash)`)
      } catch (err) {
        console.error(err)
        return false
      }
    }

    return true
  }

  /**
   * Load a block from storage
   * @returns {Object} Object of metadata key/value pairs
   */
  async load () {
    await this.open()
    let blockData = await this._chain._chain._chain.all('SELECT * FROM block WHERE i = ? LIMIT 1', [this.index])
    let metaData = {}

    if (blockData.length === 1) {
      metaData = {
        index: this.index,
        hash: blockData[0]['hash'],
        previousHash: blockData[0]['previousHash'],
        length: blockData[0]['length'],
        entropy: blockData[0]['entropy'],
        timestamp: blockData[0]['timestamp']
      }
    }

    return metaData
  }

  /**
   * Load Transaction Hashes from storage
   * @param {Boolean} [allData=false] - Return all data
   * @returns {Array} Array of transaction hashes
   */
  async loadTransactionHashes (allData = false) {
    let hashArray = []

    if (this._block !== null) {
      let hashRows = await this._block.all(`SELECT * FROM block_${this.index} ORDER BY i ASC`)

      if (hashRows.length > 0) {
        if (allData === false) {
          hashRows.forEach((row, i) => {
            hashArray.push(row['hash'])
          })
        } else {
          hashArray = hashRows
        }
      }
    }

    return hashArray
  }

  /**
   * Open the storage device
   */
  async open () {
    if (this._block === null) {
      let paddedIndex = `00000000000${this.index}`.substring(this.index.toString().length)
      this._block = await sqlite.open(`${this.path}/${this.name}.b_${paddedIndex}.db`, { Promise })
    }
  }
}

/**
 * Manage Chain Storage to SQLite
 * @class
 * @memberof module:Storage/SQLite
 */
class Chain {
  /**
   * @constructor
   * @param {String} name - Path and Name of the Chain
   */
  constructor (name) {
    this.path = path.dirname(name)
    this.name = path.basename(name)
  }

  /**
   * Retrieve the last committed block in the chain
   * @returns {Object} Last block metadata from the chain
   */
  async getLastBlock () {
    // Get the last entry in the block list for previous block
    let finalRow = await this._chain.all('SELECT * FROM block ORDER BY i DESC LIMIT 1')

    return finalRow
  }

  /**
   * Initialize the chain
   * @param {Boolean} [reload=true] - Reload the existing data. Set to false to delete all chain data
   * @returns {Boolean} Status of initialization
   */
  async initialize (reload = true) {
    if (reload === false) {
      try {
        // Clear out the chain's data files
        if (fs.existsSync(this.path)) {
          fs.readdirSync(this.path).forEach((file, index) => {
            if (file.indexOf(this.name) !== -1) {
              fs.unlinkSync(path.join(this.path, file))
            }
          })
        }
      } catch (err) {
        return false
      }
    }

    try {
      this._chain = await sqlite.open(`${this.path}/${this.name}.db`, { Promise })
      this._transIDX = await sqlite.open(`${this.path}/${this.name}.t.idx.db`, { Promise })
      this._memberTIDX = await sqlite.open(`${this.path}/${this.name}.m.t.idx.db`, { Promise })
      this._memberFIDX = await sqlite.open(`${this.path}/${this.name}.m.f.idx.db`, { Promise })

      // Initialize block table
      await this._chain.run(`CREATE TABLE IF NOT EXISTS block (i INTEGER PRIMARY KEY ASC, hash VARCHAR, previousHash VARCHAR, length INTEGER, entropy INTEGER, timestamp INTEGER)`)
      await this._chain.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_b_h ON block (hash)`)
      await this._chain.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_b_ph ON block (previousHash)`)

      await this._transIDX.run(`CREATE TABLE IF NOT EXISTS trans (hash VARCHAR PRIMARY KEY, f VARCHAR, t VARCHAR, nom FLOAT, block INTEGER, i INTEGER)`)

      await this._memberFIDX.run(`CREATE TABLE IF NOT EXISTS member (hash VARCHAR, f VARCHAR, t VARCHAR, nom FLOAT, block INTEGER)`)
      await this._memberFIDX.run(`CREATE INDEX IF NOT EXISTS idx_t_f ON member (f)`)

      await this._memberTIDX.run(`CREATE TABLE IF NOT EXISTS member (hash VARCHAR, f VARCHAR, t VARCHAR, nom FLOAT, block INTEGER)`)
      await this._memberTIDX.run(`CREATE INDEX IF NOT EXISTS idx_t_t ON member (t)`)
    } catch (err) {
      return false
    }

    return true
  }

  /**
   * Find Transaction metadata by id
   * @param {String} transactionID - Transaction Hash value to locate
   * @returns {Object} Transaction metadata
   */
  async findTransactionByHash (transactionHash) {
    let transData = await this._transIDX.all(`SELECT * FROM trans WHERE hash = ? LIMIT 1`, [transactionHash])

    return transData
  }

  /**
   * Find Transaction metadata by author
   * @param {String} transactionID - Transaction Hash value to locate
   * @returns {Object} Transaction metadata
   */
  async findTransactionByMember (member, startPOS = 0, limit = 500) {
  }
}

exports.Block = Block
exports.Chain = Chain
