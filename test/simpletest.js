'use strict'

const tc = require('../src/simplechain')
const {promisify} = require('util')

async function run () {
  let chain = new tc.Chain('nathan')
  await chain.initialize()

  await chain.add(new tc.Block({data: 'more data'}))
  await chain.add(new tc.Block('more data 1'))
  await chain.add(new tc.Block('more data 2'))
  await chain.add(new tc.Block('more data 3'))
  await chain.add(new tc.Block('more data 4'))

  let rows = await chain._chain.all('SELECT * FROM chain')

  console.log(rows)

  await chain.anchor()

  rows = await chain._anchor.all('SELECT * FROM anchor')

  console.log(rows)

  console.log(chain.length)

  await chain._chain.close()
  await chain._anchor.close()
}

let runAsync = promisify(run)

runAsync()
