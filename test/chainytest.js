'use strict'

const tc = require('../src/chainy')
const {promisify} = require('util')

async function run () {
  let chain = new tc.Chain('chainy')
  await chain.initialize()

  await chain.add(new tc.Transaction({data: 'more data'}))
  await chain.add(new tc.Transaction('more data 1'))
  await chain.add(new tc.Transaction('more data 2'))
  await chain.add(new tc.Transaction('more data 3'))
  await chain.add(new tc.Transaction('more data 4'))

  // let rows = await chain._chain.all('SELECT * FROM block_0')
  // console.log(rows)
  let rows = await chain._chain.all('SELECT * FROM block')
  console.log(rows)

  // await chain.anchor()

  // rows = await chain._chain.all('SELECT * FROM anchor')

  // console.log(rows)

  // console.log(chain.length)
  // console.log(chain.currentBlock.hash)

  await chain._chain.close()
}

let runAsync = promisify(run)

runAsync()
