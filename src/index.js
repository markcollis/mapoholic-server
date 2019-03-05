// Main starting point of the application
require('dotenv').config(); // import environment variables from .env file
const express = require('express'); // node.js web application framework
const https = require('https'); // support for https connections
const fs = require('fs'); // filesystem access for https certificate and key
const bodyParser = require('body-parser'); // middleware: format responses
const morgan = require('morgan'); // middleware: logging framework
const cors = require('cors'); // middleware: support CORS requests

const app = express(); // create an instance of express to use
const router = require('./router'); // routes in seperate file
const logger = require('./utils/logger'); // central control of logging

// configuration based on environment variables
const port = process.env.PORT || 3090;
const env = process.env.NODE_ENV || 'development';
if (env === 'development') {
  process.env.MONGODB_URI = process.env.DB_URI;
} else if (env === 'test') {
  process.env.MONGODB_URI = process.env.DB_TEST_URI;
}
if (!process.env.JWT_SECRET) {
  logger('warning')('*** Warning: default JWT secret is being used ***');
  process.env.JWT_SECRET = 'insecure if environment variable not set';
}
const httpsKey = process.env.HTTPS_KEY || './certs/localhost-key.pem';
const httpsCert = process.env.HTTPS_CERT || './certs/localhost.pem';

// Database setup
require('./utils/db');

// App setup
app.use(morgan('dev')); // middleware: logging framework for requests
// output is: method url status response time - response-length
app.use(cors()); // middleware: support CORS requests from anywhere (OK for dev)
app.use(bodyParser.json({ type: '*/*' })); // middleware: treat ALL incoming requests as JSON
router(app);

// Server setup (get express to talk to the outside world...)
const server = https.createServer({ // https is essential to protect data in transit
  key: fs.readFileSync(httpsKey),
  cert: fs.readFileSync(httpsCert),
}, app); // forward anything to the app instance
server.listen(port);
logger('success')('HTTPS server listening on port:', port);

module.exports = { server }; // for test scripts
