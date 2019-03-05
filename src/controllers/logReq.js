// detailed logging of request to use across all controllers during development
/* eslint no-console: 0 */
const chalk = require('chalk');

const logReq = (req) => {
  console.log(chalk.inverse(req.method, req.url, req.route));
  console.log(chalk.blue('req.body:', JSON.stringify(req.body)));
  console.log(chalk.blue('req.params:', JSON.stringify(req.params)));
  console.log(chalk.blue('req.query:', JSON.stringify(req.query)));
  console.log(chalk.blue('req.user:', JSON.stringify(req.user)));
  console.log(chalk.inverse('---end of req------------------------------'));
};

module.exports = { logReq };
