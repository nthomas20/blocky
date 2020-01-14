/* global describe before it after */

'use strict'

/**
 * Tests for testing data block chain
 * @author Nathaniel Thomas <nthomas20@gmail.com>
 */

const simpleChain = require('../src/Blockchain/simplechain')
const fs = require('fs')
const chai = require('chai')

chai.should()

describe(`Test simplechain`, () => {
  let chain

  before(async (done) => {
    chain = new simpleChain.Chain('test/simple')
    await chain.initialize()
  })

  it(`should add data to the simple chain`, async (done) => {
    await chain.add(new simpleChain.Block('more data 1'))
    await chain.add(new simpleChain.Block('more data 2'))
    await chain.add(new simpleChain.Block('more data 3'))
    await chain.add(new simpleChain.Block('more data 4'))

    chain.length.should.equal(4)
    done()
  })

  after((done) => {
    fs.unlinkSync('test/data/simple.db')
    fs.unlinkSync('test/data/simple.anchor.db')
    done()
  })
})
/*
describe(`Test chainy`, () => {

})
*/
