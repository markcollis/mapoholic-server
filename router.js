// Export a routing file that will be used in index.js
// where app is the express instance.
const passport = require('passport');
const Authentication = require('./controllers/authentication');
require('./services/passport'); // passport config

const requireAuth = passport.authenticate('jwt', { session: false });
const requireLogin = passport.authenticate('local', { session: false });

module.exports = (app) => {
  //    *** /users routes ***  [Users and Profile models]
  // create a user account, receive a token in return
  app.post('/users/signup', Authentication.signup);
  // log in to an existing user account, getting a token in return
  app.post('/users/login', requireLogin, Authentication.login);
  // retrieve a list of all users (ids) matching specified criteria
  app.get('/users', requireAuth, (req, res) => {
    res.send({ message: 'GET /users is still TBD' });
  });
  // retrieve full details for the currently logged in user
  app.get('/users/me', requireAuth, (req, res) => {
    res.send({ message: 'GET /users/me is still TBD' });
  });
  // retrieve full details for the specified user
  app.get('/users/:id', (req, res) => {
    // no requireAuth as only public users' ids will be exposed via /users/public route
    res.send({ message: 'GET /users/:id is still TBD' });
  });
  // retrieve a list of all publicly visible users (ids) matching specified criteria
  app.get('/users/public', (req, res) => {
    res.send({ message: 'GET /users/public is still TBD' });
  });
  // update the specified user (multiple amendment not supported)
  app.patch('/users/:id', requireAuth, (req, res) => {
    res.send({ message: 'PATCH /users/:id is still TBD' });
  });
  // delete the specified user (multiple deletion not supported)
  app.delete('/users/:id', requireAuth, (req, res) => {
    res.send({ message: 'DELETE /users:id is still TBD' });
  });

  //    *** /clubs routes ***  [Club model]

  //    *** /events routes ***  [OEvent and LinkedEvent models]

  //    *** to be deleted when others are complete ***
  app.get('/test', (req, res) => {
    res.send({ greeting: 'Hi there! No auth required here.' });
  });
  app.get('/', requireAuth, (req, res) => {
    res.send({ greeting: 'Hi there!' });
  });
  // add any other routes as required following the same pattern with
  // requireAuth and a callback for the desired action
  app.post('/login', requireLogin, Authentication.login); // => /users, front end to be changed
  app.post('/signup', Authentication.signup); // => /users, front end to be changed
};
