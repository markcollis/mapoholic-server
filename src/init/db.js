const mongoose = require('mongoose'); // manage connections to MongoDB
const logger = require('../services/logger');

mongoose.set('runValidators', true);
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useCreateIndex: true,
  useFindAndModify: false,
});
mongoose.connection.on('connected', () => {
  logger('success')('-> Mongoose connected to', process.env.MONGODB_URI);
});
mongoose.connection.on('disconnected', () => {
  logger('error')('-> Mongoose disconnected from', process.env.MONGODB_URI);
});
mongoose.connection.on('error', (err) => {
  if (err.message.match(/failed to connect to server .* on first connect/)) {
    logger('fatalError')('-> Mongoose unable to connect to database, it is running?');
    process.exit(0);
  }
  logger('error')('-> Mongoose error:', err.message);
});
process.on('SIGINT', () => {
  mongoose.connection.close(() => {
    logger('fatalError')('-> Mongoose disconnected on application termination');
    process.exit(0);
  });
});
