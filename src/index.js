'use strict'

/**
 * Primary package module
 * @author Nathaniel Thomas <nthomas20@gmail.com>
 */

module.exports = {
  Blockchain: {
    Chainy: require('./Blockchain/Chainy'),
    simplechain: require('./Blockchain/simplechain')
  },
  Storage: {
    SQLite: require('./Storage/SQLite')
  }
}
