// common logging calls, should be no console.log elsewhere in codebase
/* eslint no-console: 0 */
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

module.exports = logType => (...contents) => {
  const joinedContents = contents.join(' ');
  let output;
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
  fs.appendFile(path.join(__dirname, '../logs/app.log'), output.concat('\n'), (err) => {
    if (err) throw err;
  });
  // console.log(output);
};
