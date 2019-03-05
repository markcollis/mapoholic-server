// detailed logging of request to use across all controllers during development
const logger = require('../utils/logger');

module.exports = (req) => {
  logger('separator')(req.method, req.url, JSON.stringify(req.route.path));
  logger('info')('req.body:', JSON.stringify(req.body));
  logger('info')('req.params:', JSON.stringify(req.params));
  logger('info')('req.query:', JSON.stringify(req.query));
  logger('info')('req.user:', JSON.stringify(req.user));
  logger('separator')('---end of req------------------------------');
};
