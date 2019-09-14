// common logging calls, should be no console.log elsewhere in codebase
/* eslint no-console: 0 */
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

const LOG_TO_FILE = true; // if false, log to console

module.exports = logType => (...contents) => {
  const joinedContents = contents.join(' ');
  let output = `${logType}: ${joinedContents}`;
  if (!LOG_TO_FILE) { // colour output if direct to console
    switch (logType) {
      case 'success':
        output = chalk.green(joinedContents);
        break;
      case 'warning':
        output = chalk.yellow(joinedContents);
        break;
      case 'error':
        output = chalk.red(joinedContents);
        break;
      case 'fatalError':
        output = chalk.bold.bgRed(joinedContents);
        break;
      case 'separator':
        output = chalk.inverse(joinedContents);
        break;
      case 'info':
        output = chalk.blue(joinedContents);
        break;
      default:
        output = joinedContents;
    }
  }
  const now = new Date();
  const toWrite = now.toLocaleString().concat('\n').concat(output).concat('\n');
  fs.appendFile(path.join(__dirname, '../logs/app.log'), toWrite, (err) => {
    if (err) {
      console.log('Error writing application log:', err.message);
    }
  });
};
