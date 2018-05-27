'use strict'

const Blocky = require('../src/index')
const {promisify} = require('util')

let chain
let complete = false
let tx1, tx2

async function end () {
  console.log('END')
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

  console.log('--- finding hashes')
  rows = await chain.findTransactionByHash(tx1.hash)
  console.log(rows)
  rows = await chain.findTransactionByHash(tx2.hash)
  console.log(rows)

  // Since blocks are written asynchronously, premature closure of tables will prevent full block writes
  await chain._chain._chain.close()
  await chain._chain._transIDX.close()
  await chain._chain._memberFIDX.close()
  await chain._chain._memberTIDX.close()

  await chain.delete()
}

let endAsync = promisify(end)

async function run () {
  chain = new Blocky.Blockchain.Chainy.Chain('data/fork/chainy', Blocky.Storage.SQLite, null, {
    powHashPrefix: '000',
    maxBlockTransactions: 3,
    transactionPrefix: 'tX'
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
    console.log('blockCommitQueueEmpty', complete)
    if (complete === true) {
      // gotta wait until we're complete adding our transactions so we know the final complete
      // means that all blocks have been written
      endAsync()
    }
  })

  await chain.initialize(false) // false means don't load an existing chain, default = true
  tx1 = new Blocky.Blockchain.Chainy.Transaction('my data 1', '6a4c34ea3b443565b0c03f84ea6d0567208bb670afa7bcb97ac8ff7d0ebb3284', '8d0b9facf0e5ee78df9b68032e1574a759f0308eaec154e6b8346697b2e6b75c', 5)
  await chain.add(tx1)
  await chain.add(new Blocky.Blockchain.Chainy.Transaction('my data 2'))
  await chain.add(new Blocky.Blockchain.Chainy.Transaction('my data 3'))
  tx2 = new Blocky.Blockchain.Chainy.Transaction('my data 4')
  await chain.add(tx2)
  await chain.add(new Blocky.Blockchain.Chainy.Transaction('my data 5'))
  await chain.add(new Blocky.Blockchain.Chainy.Transaction('my data 6'))

  console.log('made all the transactions')

  complete = true
}

let runAsync = promisify(run)

runAsync()
