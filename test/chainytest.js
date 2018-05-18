'use strict'

const tc = require('../src/chainy')
const {promisify} = require('util')

async function run () {
  let chain = new tc.Chain('chainy')
  await chain.initialize()

  await chain.add(new tc.Transaction('my data 1'))
  await chain.add(new tc.Transaction('my data 2'))
  await chain.add(new tc.Transaction('my data 3'))
  await chain.add(new tc.Transaction('my data 4'))
  await chain.add(new tc.Transaction('my data 5'))
  await chain.add(new tc.Transaction('my data 6'))

  let rows
  rows = await chain._chain.all('SELECT * FROM block')
  console.log(rows)
  rows = await chain._chain.all('SELECT * FROM trans')
  console.log(rows)

  console.log(chain.length)
  console.log(chain.workingBlock.length)
  console.log(chain.workingBlock.previousHash)

  let block = new tc.Block(chain)
  await block.load(0)
  console.log(block.length)
  console.log(block._transactionHashArray)

  await chain._chain.close()
}

let runAsync = promisify(run)

runAsync()
