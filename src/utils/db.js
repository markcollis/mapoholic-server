const mongoose = require('mongoose'); // manage connections to MongoDB
const logger = require('./logger');

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useCreateIndex: true,
  useFindAndModify: false,
});
mongoose.connection.on('connected', () => {
  logger('success')(new Date(), '\n -> Mongoose connected to', process.env.MONGODB_URI);
});
mongoose.connection.on('disconnected', () => {
  logger('error')(new Date(), '\n -> Mongoose disconnected from', process.env.MONGODB_URI);
});
mongoose.connection.on('error', (err) => {
  if (err.message.match(/failed to connect to server .* on first connect/)) {
    logger('fatalError')(new Date(), '\n -> Mongoose unable to connect to database, it is running?');
    process.exit(0);
  }
  logger('error')(new Date(), '\n -> Mongoose error:', err.message);
});
process.on('SIGINT', () => {
  mongoose.connection.close(() => {
    logger('fatalError')(new Date(), '\n -> Mongoose disconnected on application termination');
    process.exit(0);
  });
});
