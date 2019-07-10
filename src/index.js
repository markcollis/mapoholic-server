// Main starting point of the application
require('dotenv').config(); // import environment variables from .env file
const express = require('express'); // node.js web application framework
const https = require('https'); // support for https connections
const fs = require('fs'); // filesystem access for https certificate and key
const path = require('path'); // manage filesystem paths
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
} else if (env === 'local') {
  process.env.MONGODB_URI = process.env.DB_LOCAL_URI;
}

if (!process.env.JWT_SECRET) {
  logger('warning')('*** Warning: default JWT secret is being used ***');
  process.env.JWT_SECRET = 'insecure if environment variable not set';
}
const httpsKey = process.env.HTTPS_KEY || './certs/localhost+1-key.pem';
const httpsCert = process.env.HTTPS_CERT || './certs/localhost+1.pem';

// Database setup
require('./utils/db');

// App setup
app.use(morgan('dev')); // middleware: logging framework for requests
// output is: method url status response time - response-length
const corsWhitelist = ['https://localhost:3000', 'https://192.168.0.15:3000'];
const corsOptions = {
  origin: (origin, callback) => {
    console.log('CORS request with origin:', origin);
    if (!origin) {
      console.log('ACCEPT: origin undefined (same-origin)');
      return callback(null, true);
    }
    if (corsWhitelist.indexOf(origin) !== -1) {
      console.log('ACCEPT: CORS origin on whitelist');
      return callback(null, true);
    }
    console.log('REJECT: CORS origin not on whitelist');
    return callback(new Error('Not on CORS whitelist'));
  },
};
app.options('*', cors(corsOptions)); // limit CORS to expected origin
app.use('*', cors(corsOptions));
// app.use(cors()); // middleware: support CORS requests from anywhere (OK for dev)
// app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use('/images', express.static(path.join(__dirname, 'images')));
router(app);

// Server setup (get express to talk to the outside world...)
const server = https.createServer({ // https is essential to protect data in transit
  key: fs.readFileSync(httpsKey),
  cert: fs.readFileSync(httpsCert),
}, app); // forward anything to the app instance
server.listen(port);
logger('success')('HTTPS server listening on port:', port);

module.exports = { server }; // for test scripts
