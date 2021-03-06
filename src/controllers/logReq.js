// detailed logging of request to assist development
// disable in production to avoid excessively large log file
const logger = require('../services/logger');

const ENABLE = false; // turn on/off completely

module.exports = (req) => {
  if (ENABLE) {
    logger('separator')(req.method, req.url, JSON.stringify(req.route.path));
    logger('info')('req.body:', JSON.stringify(req.body, null, 2));
    logger('info')('req.params:', JSON.stringify(req.params, null, 2));
    logger('info')('req.query:', JSON.stringify(req.query, null, 2));
    logger('info')('req.file:', JSON.stringify(req.file, null, 2));
    logger('info')('req.user:', JSON.stringify(req.user, null, 2));
    logger('separator')('---end of req------------------------------');
  }
};
