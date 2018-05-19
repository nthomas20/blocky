'use strict'

/**
 * SQLite engine for chain management
 * @author Nathaniel Thomas <nthomas20@gmail.com>
 */

const sqlite = require('sqlite')
const fs = require('fs')
const path = require('path')

class Block {
  constructor (chain, index) {
    this.path = path.dirname(chain.name)
    this.name = path.basename(chain.name)
    this.index = index
    this._chain = chain
    this._block = null
  }

  async addTransactionToBlock (transaction, length) {
    if (this._block !== null) {
      await this._block.run(`INSERT INTO block_${this.index} VALUES (?, ?, ?, ?)`, [
        length,
        transaction.hash,
        transaction.timestamp,
        JSON.stringify(transaction.data)
      ])

      return true
    }

    return false
  }

  async commit (metaData) {
    // Check if block is the current working block
    try {
      await this._chain._chain._chain.run('INSERT INTO block VALUES (?, ?, ?, ?, ?, ?)', metaData)

      let hashArray = await this.loadTransactionHashes()

      for (let t in hashArray) {
        await this._chain._chain._transIDX.run('INSERT INTO trans VALUES (?, ?)', [hashArray[t], this.index])
      }

      await this._block.close(true)

      return true
    } catch (err) {
      return false
    }
  }

  async delete () {
    if (this._block !== null) {
      await this._block.run(`DROP TABLE IF EXISTS block_${this.index}`)
      await this._block.run(`DROP INDEX IF EXISTS idx_b_h_${this.index}`)
    }
  }

  async initialize () {
    if (this._block === null) {
      await this.open()

      await this.delete()

      await this._block.run(`CREATE TABLE IF NOT EXISTS block_${this.index} (i INTEGER PRIMARY KEY ASC, hash VARCHAR, timestamp INTEGER, data VARCHAR)`)
      await this._block.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_b_h_${this.index} ON block_${this.index} (hash)`)
    }
  }

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
        nonce: blockData[0]['nonce'],
        timestamp: blockData[0]['timestamp']
      }
    }

    return metaData
  }

  async loadTransactionHashes () {
    let hashArray = []

    if (this._block !== null) {
      let hashRows = await this._block.all(`SELECT i, hash FROM block_${this.index} ORDER BY i ASC`)

      if (hashRows.length > 0) {
        hashRows.forEach((row, i) => {
          hashArray.push(row['hash'])
        })
      }
    }

    return hashArray
  }

  async open () {
    if (this._block === null) {
      this._block = await sqlite.open(`${this.path}/b_${this.name}_${this.index}.db`, { Promise })
    }
  }
}

class Chain {
  constructor (name) {
    this.path = path.dirname(name)
    this.name = path.basename(name)
  }

  async getLastBlock () {
    // Get the last entry in the block list for previous block
    let finalRow = await this._chain.all('SELECT * FROM block ORDER BY i DESC LIMIT 1')

    return finalRow
  }

  async initialize (reload = true) {
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

    return true
  }
}

exports.Block = Block
exports.Chain = Chain
