'use strict'

const Blocky = require('../src/index')
const {promisify} = require('util')

let chain
let complete = false

async function end () {
  let rows
  console.log('--- blocks')
  rows = await chain._chain._chain.all('SELECT * FROM block')
  console.log(rows)

  console.log('--- trans')
  rows = await chain._chain._transIDX.all('SELECT * FROM trans')
  console.log(rows)

  console.log('chain.length', chain.length)

  console.log('--- block 2 info')
  let block = new Blocky.Blockchain.Chainy.Block(chain, 2)
  await block.load()
  console.log(block.metaData)
  console.log(block._transactionHashArray)

  // Since blocks are written asynchronously, premature closure of tables will prevent full block writes
  await chain._chain._chain.close()
  await chain._chain._transIDX.close()
}

let endAsync = promisify(end)

async function run () {
  chain = new Blocky.Blockchain.Chainy.Chain('data/chainy', Blocky.Storage.SQLite, {
    powHashPrefix: '000',
    maxBlockTransactions: 1
  })

  chain.on('blockSubmit', (index) => {
    console.log('block submitted', index)
  })

  chain.on('blockCommit', (index, job) => {
    console.log('block committed', index)
  })

  chain.on('blockCommitError', (index, job) => {
    console.log('block commit error', index)
  })

  chain.on('blockCommitQueueEmpty', () => {
    if (complete === true) {
      // gotta wait until we're complete adding our transactions so we know the final complete
      // means that all blocks have been written
      endAsync()
    }
  })

  await chain.initialize(false) // false means don't load an existing chain, default = true
  await chain.add(new Blocky.Blockchain.Chainy.Transaction('my data 1'))
  await chain.add(new Blocky.Blockchain.Chainy.Transaction('my data 2'))
  await chain.add(new Blocky.Blockchain.Chainy.Transaction('my data 3'))
  await chain.add(new Blocky.Blockchain.Chainy.Transaction('my data 4'))
  await chain.add(new Blocky.Blockchain.Chainy.Transaction('my data 5'))
  await chain.add(new Blocky.Blockchain.Chainy.Transaction('my data 6'))

  complete = true
}

let runAsync = promisify(run)

runAsync()
