// Export routing file that will be used in index.js
//   where app is the express instance.
const passport = require('passport');
const Authentication = require('./controllers/authentication');
const Users = require('./controllers/users');
// const Clubs = require('./controllers/clubs');
// const Events = require('./controllers/events');

require('./services/passport'); // passport config

// each route should have one of these three middleware options to set req.user
const requireAuth = passport.authenticate('jwt', { session: false }); // bearer token in header
const requireLogin = passport.authenticate('local', { session: false }); // request token
const publicRoute = (req, res, next) => { // anonymous access permitted, take care to limit response
  req.user = { role: 'anonymous' };
  next();
};

module.exports = (app) => {
  // *** /users routes ***  [User model]
  // create a user account, receive a token in return
  app.post('/users/', Authentication.signup);
  // log in to an existing user account, getting a token in return
  app.post('/users/login', requireLogin, Authentication.login);
  // reset password of specified user
  app.post('/users/:id/password', requireAuth, Authentication.passwordChange);
  // retrieve a list of all users (ids) matching specified criteria
  app.get('/users', requireAuth, Users.getUserList);
  app.get('/users/public', publicRoute, Users.getUserList);
  // retrieve full details for the currently logged in user
  app.get('/users/me', requireAuth, Users.getLoggedInUser);
  // retrieve full details for the specified user
  app.get('/users/:id', requireAuth, Users.getUserById);
  app.get('/users/public/:id', publicRoute, Users.getUserById);
  // update the specified user (multiple amendment not supported)
  app.patch('/users/:id', requireAuth, Users.updateUser);
  // delete the specified user (multiple deletion not supported)
  app.delete('/users/:id', requireAuth, Users.deleteUser);

  // *** /clubs routes ***  [Club model]
  // create a club
  app.post('/clubs', requireAuth, (req, res) => {
    res.send({ message: 'POST /clubs is still TBD' });
  });
  // retrieve a list of all clubs (ids) matching specified criteria
  app.get('/clubs', (req, res) => {
    res.send({ message: 'GET /clubs is still TBD' });
  });
  // retrieve full details for the specified club
  app.get('/clubs/:id', (req, res) => {
    res.send({ message: 'GET /clubs/:id is still TBD' });
  });
  // update the specified club (multiple amendment not supported)
  app.patch('/clubs/:id', requireAuth, (req, res) => {
    res.send({ message: 'PATCH /clubs/:id is still TBD' });
  });
  // delete the specified club (multiple deletion not supported)
  app.delete('/clubs/:id', requireAuth, (req, res) => {
    res.send({ message: 'DELETE /clubs/:id is still TBD' });
  });

  // *** /events routes ***  [OEvent and LinkedEvent models]
  // create an event
  app.post('/events', requireAuth, (req, res) => {
    res.send({ message: 'POST /events is still TBD' });
  });
  // create a map within the specified event
  app.post('/events/:id/maps', requireAuth, (req, res) => {
    res.send({ message: 'POST /events/:id/maps is still TBD' });
  });
  // create a new event linkage between the specified events
  app.post('/events/links', requireAuth, (req, res) => {
    res.send({ message: 'POST /events/links is still TBD' });
  });
  // retrieve a list of all events (ids) matching specified criteria
  //   [may include events without *maps* visible to current user]
  app.get('/events', requireAuth, (req, res) => {
    res.send({ message: 'GET /events is still TBD' });
  });
  // retrieve a list of all events (ids) with publicly visible maps
  //   [unlike authorised list there is no point in events without maps]
  app.get('/events/public', (req, res) => {
    res.send({ message: 'GET /events/public is still TBD' });
  });
  // retrieve full details for the specified event
  //   [includes embedded maps and basic info for linked events]
  app.get('/events/:id', (req, res) => {
    res.send({ message: 'GET /events/:id is still TBD' });
  });
  // retrieve a list of links between events matching specified criteria
  app.get('/events/links', requireAuth, (req, res) => {
    res.send({ message: 'GET /events/links is still TBD' });
  });
  // retrieve full details of the specified link between events
  app.get('/events/links/:id', (req, res) => {
    res.send({ message: 'GET /events/links/:id is still TBD' });
  });
  // update the specified event (multiple amendment not supported)
  app.patch('/events/:id', requireAuth, (req, res) => {
    res.send({ message: 'PATCH /events/:id is still TBD' });
  });
  // update the specified map (multiple amendment not supported)
  app.patch('/events/:id/maps/:id', requireAuth, (req, res) => {
    res.send({ message: 'PATCH /events/:id/maps/:id is still TBD' });
  });
  // update the specified link between events (multiple amendment not supported)
  app.patch('/events/links/:id', requireAuth, (req, res) => {
    res.send({ message: 'PATCH /events/links/:id is still TBD' });
  });
  // delete the specified event (multiple delete not supported)
  //   [also deletes embedded maps if same owner, otherwise fails]
  app.delete('/events/:id', requireAuth, (req, res) => {
    res.send({ message: 'DELETE /events/:id is still TBD' });
  });
  // delete the specified map (multiple delete not supported)
  app.delete('/events/:id/maps/:id', requireAuth, (req, res) => {
    res.send({ message: 'DELETE /events/:id/maps/:id is still TBD' });
  });
  // delete the specified link between events (multiple delete not supported)
  app.delete('/events/links/:id', requireAuth, (req, res) => {
    res.send({ message: 'DELETE /events/links/:id is still TBD' });
  });


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
