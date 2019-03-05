// Main starting point of the application
require('dotenv').config(); // import environment variables from .env file
const express = require('express'); // node.js web application framework
const https = require('https'); // support for https connections
const fs = require('fs'); // filesystem access for https certificate and key
const mongoose = require('mongoose'); // manage connections to MongoDB
const bodyParser = require('body-parser'); // middleware: format responses
const morgan = require('morgan'); // middleware: logging framework
const cors = require('cors'); // middleware: support CORS requests
const chalk = require('chalk'); // colours for console logs

const app = express(); // create an instance of express to use
const router = require('./router');

// configuration based on environment variables
const port = process.env.PORT || 3090;
const env = process.env.NODE_ENV || 'development';
if (env === 'development') {
  process.env.MONGODB_URI = process.env.DB_URI;
} else if (env === 'test') {
  process.env.MONGODB_URI = process.env.DB_TEST_URI;
}
if (!process.env.JWT_SECRET) {
  console.log('*** Warning: default JWT secret is being used ***');
  process.env.JWT_SECRET = 'insecure if environment variable not set';
}
const httpsKey = process.env.HTTPS_KEY || './certs/localhost-key.pem';
const httpsCert = process.env.HTTPS_CERT || './certs/localhost.pem';

// Database setup
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useCreateIndex: true,
  useFindAndModify: false,
});
mongoose.connection.on('connected', () => {
  console.log(chalk.green(new Date(), '\n -> Mongoose connected to', process.env.MONGODB_URI));
});
mongoose.connection.on('disconnected', () => {
  console.log(chalk.red(new Date(), '\n -> Mongoose disconnected from', process.env.MONGODB_URI));
});
mongoose.connection.on('error', (err) => {
  if (err.message.match(/failed to connect to server .* on first connect/)) {
    console.error(chalk.bold.bgRed(new Date(), '\n -> Mongoose unable to connect to database, it is running?'));
    process.exit(0);
  }
  console.error(chalk.bold.red(new Date(), '\n -> Mongoose error:', err.message));
});
process.on('SIGINT', () => {
  mongoose.connection.close(() => {
    console.log(chalk.bold.red(new Date(), '\n -> Mongoose disconnected on application termination'));
    process.exit(0);
  });
});

// App setup
app.use(morgan('dev')); // middleware: logging framework
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
console.log('Server listening on port: ', port);

module.exports = { server }; // for test scripts
