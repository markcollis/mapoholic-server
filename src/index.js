// Main starting point of the application
require('dotenv').config(); // import environment variables from .env file
const express = require('express'); // node.js web application framework
const http = require('http');
// const https = require('https'); // support for https connections (tested, not currently needed)
const fs = require('fs'); // filesystem access
const path = require('path'); // manage filesystem paths
const bodyParser = require('body-parser'); // middleware: format responses
const morgan = require('morgan'); // middleware: logging framework
const cors = require('cors'); // middleware: support CORS requests

const app = express(); // create an instance of express to use
const router = require('./router'); // routes in seperate file
const logger = require('./services/logger'); // central control of logging

// configuration based on environment variables
const port = process.env.PORT || 3090;
const nodeEnv = process.env.NODE_ENV;
if (nodeEnv === 'test') {
  process.env.MONGODB_URI = process.env.DB_TEST_URI;
} else if (nodeEnv === 'local') {
  process.env.MONGODB_URI = process.env.DB_LOCAL_URI;
}

if (!process.env.JWT_SECRET) {
  logger('warning')('*** Warning: default JWT secret is being used ***');
  process.env.JWT_SECRET = 'insecure if environment variable not set';
}
// const httpsKey = process.env.HTTPS_KEY || './certs/localhost+1-key.pem';
// const httpsCert = process.env.HTTPS_CERT || './certs/localhost+1.pem';

// Database setup
require('./init/db');

// App setup
app.use(morgan('dev')); // middleware: logging framework for requests
// output is: method url status response time - response-length
const accessLogStream = fs.createWriteStream(path.join(__dirname, 'logs/access.log'), { flags: 'a' });
app.use(morgan('common', { stream: accessLogStream }));
// log to file
const corsWhitelist = ['https://localhost:3000', 'https://192.168.0.15:3000',
  'http://localhost:3000', 'http://192.168.0.15:3000',
  'https://localhost:5000', 'https://192.168.0.15:5000',
  'http://localhost:5000', 'http://192.168.0.15:5000',
  'http://85.71.168.97', 'http://mapoholic.markcollis.dev', 'https://mapoholic.markcollis.dev'];
const corsOptions = {
  origin: (origin, callback) => {
    // logger('info')('CORS request with origin:', origin);
    if (!origin) {
      // logger('success')('ACCEPT: origin undefined (same-origin)');
      return callback(null, true);
    }
    if (corsWhitelist.indexOf(origin) !== -1) {
      // logger('success')('ACCEPT: CORS origin on whitelist');
      return callback(null, true);
    }
    logger('error')('REJECT: CORS origin not on whitelist -', origin);
    return callback(new Error('Not on CORS whitelist'));
  },
};
app.options('*', cors(corsOptions)); // limit CORS to expected origin
app.use('*', cors(corsOptions));
app.use((err, req, res, next) => {
  if (err.message !== 'Not on CORS whitelist') return next();
  return res.status(404).send('CORS error');
});
// app.use(cors()); // middleware: support CORS requests from anywhere (OK for dev)
// app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use('/images', express.static(path.join(__dirname, 'images')));
router(app);

// http server not required, handled by nginx in production
// const server = https.createServer({ // https is essential to protect data in transit
//   key: fs.readFileSync(httpsKey),
//   cert: fs.readFileSync(httpsCert),
// }, app); // forward anything to the app instance
// server.listen(port);
// logger('success')('HTTPS server listening on port:', port);

// Server setup (get express to talk to the outside world...)
const server = http.createServer(app);
server.listen(port);
logger('success')('HTTP server listening on port:', port);

module.exports = { server }; // for test scripts
