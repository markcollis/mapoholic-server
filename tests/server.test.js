// current routes on front end are:
// POST /signup { email, password }
// expects to receive response.data.token (JWT to store in browser)

// POST /login { email, password }
// expects to receive response.data.token (JWT to store in browser)

const expect = require('expect');
const request = require('supertest');
// const { ObjectID } = require('mongodb');

const { server } = require('../');
const User = require('../models/user');
// const Profile = require('../models/profile');
// const Club = require('../models/club');
// const OEvent = require('../models/oevent');
// const LinkedEvent = require('../models/linkedEvent');

const {
  initUsers,
  // initClubs,
  // initProfiles,
  // initOEvents,
  // initLinkedEvents,
  populateUsers, //     independent
  // populateClubs, //     requires user_id
  // populateProfiles, //  requires user_id, links to club_id
  // populateOEvents, //   requires user_id, links to club_id
  // populateLinkedEvents, // interdependent links to oevent_id and from oevent.linkedTo
} = require('./seed');

beforeEach(populateUsers);
// beforeEach(populateClubs);
// beforeEach(populateProfiles);
// beforeEach(populateOEvents);
// beforeEach(populateLinkedEvents);

// What routes should be developed? (tie to user requirements)
// POST /users/login
// POST /users/signup

describe('POST /users/signup', () => {
  it('should create a new user', (done) => {
    const newUser = {
      email: 'new@user.com',
      password: 'passwordfornewuser',
    };
    request(server)
      .post('/users/signup')
      .send(newUser)
      .expect(200)
      .expect((res) => {
        expect(res.body.token).toBeTruthy();
      })
      .end((err) => {
        if (err) return done(err);
        return User.find({ email: newUser.email }).then((users) => {
          expect(users.length).toBe(1);
          expect(users[0].email).toBe('new@user.com');
          done();
        }).catch(e => done(e));
      });
  });

  it('should not create a user with invalid data', (done) => {
    const newUser = {
      email: 'anothernew@user.com',
      password: '1',
    };
    request(server)
      .post('/users/signup')
      .send(newUser)
      .expect(400)
      .end((err) => {
        if (err) return done(err);
        return User.find().then((users) => {
          expect(users.length).toBe(2);
          done();
        }).catch(e => done(e));
      });
  });

  it('should not create a user if email is already in use', (done) => {
    const newUser = {
      email: initUsers[0].email,
      password: 'signedupalready',
    };
    request(server)
      .post('/users/signup')
      .send(newUser)
      .expect(400)
      .end((err) => {
        if (err) return done(err);
        return User.find().then((users) => {
          expect(users.length).toBe(2);
          done();
        }).catch(e => done(e));
      });
  });
});

describe('POST /users/login', () => {
  it('should login user and return auth token', (done) => {
    request(server)
      .post('/users/login')
      .send({
        email: initUsers[0].email,
        password: initUsers[0].password,
      })
      .expect(200)
      .expect((res) => {
        expect(res.body.token).toBeTruthy();
      })
      .end((err) => {
        if (err) return done(err);
        return done();
      });
  });

  it('should reject an invalid login (bad password)', (done) => {
    request(server)
      .post('/users/login')
      .send({
        email: initUsers[0].email,
        password: 'wrongpassword',
      })
      .expect(401)
      .end((err) => {
        if (err) return done(err);
        return done();
      });
  });

  it('should reject an invalid login (nonexistent user)', (done) => {
    request(server)
      .post('/users/login')
      .send({
        email: 'wrong@wrong.com',
        password: 'wrongpassword',
      })
      .expect(401)
      .end((err) => {
        if (err) return done(err);
        return done();
      });
  });
});

// *** all cases below this line are for reference only and do not relate to this app ***

describe('POST /todo', () => {
  // it('should create a new todo', (done) => {
  //   const text = 'Test text for todo';
  //   request(app)
  //     .post('/todo')
  //     .set('x-auth', initUsers[0].tokens[0].token)
  //     .send({ text })
  //     .expect(200)
  //     .expect((res) => {
  //       expect(res.body.text).toBe(text);
  //     })
  //     .end((err) => {
  //       if (err) return done(err);
  //       return ToDo.find({ text }).then((todos) => {
  //         expect(todos.length).toBe(1);
  //         expect(todos[0].text).toBe(text);
  //         done();
  //       }).catch(e => done(e));
  //     });
  // });
  //
  // it('should not create a todo with invalid data', (done) => {
  //   request(app)
  //     .post('/todo')
  //     .set('x-auth', initUsers[0].tokens[0].token)
  //     .send({})
  //     .expect(400)
  //     .end((err) => {
  //       if (err) return done(err);
  //       return ToDo.find().then((todos) => {
  //         expect(todos.length).toBe(2);
  //         done();
  //       }).catch(e => done(e));
  //     });
  // });
});

describe('GET /todos', () => {
  // it('should get all todos associated with authenticated user', (done) => {
  //   request(app)
  //     .get('/todos')
  //     .set('x-auth', initUsers[0].tokens[0].token)
  //     .expect(200)
  //     .expect((res) => {
  //       expect(res.body.todos.length).toBe(1);
  //     })
  //     .end(done);
  // });
});

describe('GET /todo/:id', () => {
  // it('should return the correct todo', (done) => {
  //   request(app)
  //     .get(`/todo/${initTodos[0]._id.toHexString()}`)
  //     .set('x-auth', initUsers[0].tokens[0].token)
  //     .expect(200)
  //     .expect((res) => {
  //       expect(res.body.todo.text).toBe(initTodos[0].text);
  //     })
  //     .end(done);
  // });
  //
  // it('should respond with a 404 error to an invalid ID', (done) => {
  //   request(app)
  //     .get('/todo/3971904874890')
  //     .set('x-auth', initUsers[0].tokens[0].token)
  //     .expect(404)
  //     .end(done);
  // });
  //
  // it('should respond with a 404 error to a valid but absent ID', (done) => {
  //   const testId = new ObjectID();
  //   request(app)
  //     .get(`/todo/${testId.toHexString()}`)
  //     .set('x-auth', initUsers[0].tokens[0].token)
  //     .expect(404)
  //     .end(done);
  // });
  //
  // it('should respond with a 401 error if created by a different user', (done) => {
  //   request(app)
  //     .get(`/todo/${initTodos[1]._id.toHexString()}`)
  //     .set('x-auth', initUsers[0].tokens[0].token)
  //     .expect(401)
  //     .end(done);
  // });
});

describe('DELETE /todo/:id', () => {
  // it('should remove the correct todo', (done) => {
  //   request(app)
  //     .delete(`/todo/${initTodos[0]._id.toHexString()}`)
  //     .set('x-auth', initUsers[0].tokens[0].token)
  //     .expect(200)
  //     .expect((res) => {
  //       expect(res.body.todo.text).toBe(initTodos[0].text);
  //     })
  //     .end((err) => {
  //       if (err) return done(err);
  //       return ToDo.find().then((todos) => {
  //         expect(todos.length).toBe(1);
  //         done();
  //       }).catch(e => done(e));
  //     });
  // });
  //
  // it('should respond with a 404 error to an invalid ID', (done) => {
  //   request(app)
  //     .delete('/todo/3971904874890')
  //     .set('x-auth', initUsers[0].tokens[0].token)
  //     .expect(404)
  //     .end((err) => {
  //       if (err) return done(err);
  //       return ToDo.find().then((todos) => {
  //         expect(todos.length).toBe(2);
  //         done();
  //       }).catch(e => done(e));
  //     });
  // });
  //
  // it('should repond with a 404 error to a valid but absent ID', (done) => {
  //   const testId = new ObjectID();
  //   request(app)
  //     .delete(`/todo/${testId.toHexString()}`)
  //     .set('x-auth', initUsers[0].tokens[0].token)
  //     .expect(404)
  //     .end((err) => {
  //       if (err) return done(err);
  //       return ToDo.find().then((todos) => {
  //         expect(todos.length).toBe(2);
  //         done();
  //       }).catch(e => done(e));
  //     });
  // });
  //
  // it('should repond with a 401 error if not the creator', (done) => {
  //   request(app)
  //     .delete(`/todo/${initTodos[1]._id.toHexString()}`)
  //     .set('x-auth', initUsers[0].tokens[0].token)
  //     .expect(401)
  //     .end((err) => {
  //       if (err) return done(err);
  //       return ToDo.find().then((todos) => {
  //         expect(todos.length).toBe(2);
  //         done();
  //       }).catch(e => done(e));
  //     });
  // });
});

describe('PATCH /todo/:id', () => {
  // it('should update the correct todo and set a completedAt time', (done) => {
  //   request(app)
  //     .patch(`/todo/${initTodos[0]._id.toHexString()}`)
  //     .set('x-auth', initUsers[0].tokens[0].token)
  //     .send({
  //       text: 'something different',
  //       completed: true,
  //     })
  //     .expect(200)
  //     .expect((res) => {
  //       expect(res.body.todo.text).toBe('something different');
  //       expect(res.body.todo.completed).toBe(true);
  //       expect(typeof res.body.todo.completedAt).toBe('number');
  //     })
  //     .end(done);
  // });
  //
  // it('should update the correct todo and clear the completedAt time', (done) => {
  //   request(app)
  //     .patch(`/todo/${initTodos[1]._id.toHexString()}`)
  //     .set('x-auth', initUsers[1].tokens[0].token)
  //     .send({
  //       text: 'something else different',
  //       completed: false,
  //     })
  //     .expect(200)
  //     .expect((res) => {
  //       expect(res.body.todo.text).toBe('something else different');
  //       expect(res.body.todo.completed).toBe(false);
  //       expect(res.body.todo.completedAt).toBe(null);
  //     })
  //     .end(done);
  // });
  //
  // it('should respond with a 404 error to an invalid ID', (done) => {
  //   request(app)
  //     .patch('/todo/3971904874890')
  //     .set('x-auth', initUsers[0].tokens[0].token)
  //     .expect(404)
  //     .end(done);
  // });
  //
  // it('should respond with a 404 error to a valid but absent ID', (done) => {
  //   const testId = new ObjectID();
  //   request(app)
  //     .patch(`/todo/${testId.toHexString()}`)
  //     .set('x-auth', initUsers[0].tokens[0].token)
  //     .expect(404)
  //     .end(done);
  // });
  //
  // it('should respond with a 401 error if not the creator', (done) => {
  //   request(app)
  //     .patch(`/todo/${initTodos[1]._id.toHexString()}`)
  //     .set('x-auth', initUsers[0].tokens[0].token)
  //     .send({
  //       text: 'something else different',
  //       completed: false,
  //     })
  //     .expect(401)
  //     .end(done);
  // });
});

describe('POST /user', () => {
  // it('should create a new user', (done) => {
  //   const newUser = {
  //     email: 'new@user.com',
  //     password: 'passwordfornewuser',
  //   };
  //   request(app)
  //     .post('/user')
  //     .send(newUser)
  //     .expect(200)
  //     .expect((res) => {
  //       expect(res.body._id).toBeTruthy();
  //       expect(res.body.email).toBe(newUser.email);
  //       const headerAuth = res.header['x-auth'];
  //       User.findOne({ _id: res.body._id }).then((user) => {
  //         expect(headerAuth).toBe(user.tokens[0].token);
  //       });
  //     })
  //     .end((err) => {
  //       if (err) return done(err);
  //       return User.find({ email: newUser.email }).then((users) => {
  //         expect(users.length).toBe(1);
  //         expect(users[0].email).toBe('new@user.com');
  //         done();
  //       }).catch(e => done(e));
  //     });
  // });
  //
  // it('should not create a user with invalid data', (done) => {
  //   const newUser = {
  //     email: 'anothernew@user.com',
  //     password: '123',
  //   };
  //   request(app)
  //     .post('/user')
  //     .send(newUser)
  //     .expect(400)
  //     .end((err) => {
  //       if (err) return done(err);
  //       return User.find().then((users) => {
  //         expect(users.length).toBe(2);
  //         done();
  //       }).catch(e => done(e));
  //     });
  // });
  //
  // it('should not create a user if email is already in use', (done) => {
  //   const newUser = {
  //     email: 'mark@example.com',
  //     password: 'I have signed up already',
  //   };
  //   request(app)
  //     .post('/user')
  //     .send(newUser)
  //     .expect(400)
  //     .end((err) => {
  //       if (err) return done(err);
  //       return User.find().then((users) => {
  //         expect(users.length).toBe(2);
  //         done();
  //       }).catch(e => done(e));
  //     });
  // });
});

describe('GET /user/me', () => {
  // it('should retrieve details of the currently authenticated user', (done) => {
  //   request(app)
  //     .get('/user/me')
  //     .set('x-auth', initUsers[0].tokens[0].token)
  //     .expect(200)
  //     .expect((res) => {
  //       expect(res.body.email).toBe(initUsers[0].email);
  //     })
  //     .end(done);
  // });
  //
  // it('should return a 401 status if not authenticated', (done) => {
  //   request(app)
  //     .get('/user/me')
  //     .expect(401)
  //     .expect((res) => {
  //       expect(res.text).toBe('Authentication failed.');
  //       expect(res.body).toEqual({});
  //     })
  //     .end(done);
  // });
  //
  // it('should return a 401 status if auth token valid but user not found', (done) => {
  //   request(app)
  //     .get('/user/me')
  //     .set('x-auth', 'ey...64')
  //     .expect(401)
  //     .expect((res) => {
  //       expect(res.text).toBe('Authentication failed.');
  //       expect(res.body).toEqual({});
  //     })
  //     .end(done);
  // });
});

describe('POST /user/login', () => {
  // it('should login user and return auth token', (done) => {
  //   request(app)
  //     .post('/user/login')
  //     .send({
  //       email: initUsers[1].email,
  //       password: initUsers[1].password,
  //     })
  //     .expect(200)
  //     .expect((res) => {
  //       expect(res.headers['x-auth']).toBeTruthy();
  //     })
  //     .end((err, res) => {
  //       if (err) return done(err);
  //       return User.findById(initUsers[1]._id).then((user) => {
  //         expect(user.tokens[1]).toHaveProperty('access', 'auth');
  //         expect(user.tokens[1]).toHaveProperty('token', res.headers['x-auth']);
  //         done();
  //       }).catch(e => done(e));
  //     });
  // });
  //
  // it('should reject an invalid login (bad password)', (done) => {
  //   request(app)
  //     .post('/user/login')
  //     .send({
  //       email: initUsers[1].email,
  //       password: 'wrong',
  //     })
  //     .expect(401)
  //     .expect((res) => {
  //       expect(res.headers['x-auth']).toBeFalsy();
  //     })
  //     .end((err) => {
  //       if (err) return done(err);
  //       return User.findById(initUsers[1]._id).then((user) => {
  //         expect(user.tokens.length).toBe(1);
  //         done();
  //       }).catch(e => done(e));
  //     });
  // });
  //
  // it('should reject an invalid login (nonexistent user)', (done) => {
  //   request(app)
  //     .post('/user/login')
  //     .send({
  //       email: 'wrong@wrong.com',
  //       password: 'wrong',
  //     })
  //     .expect(401)
  //     .expect((res) => {
  //       expect(res.headers['x-auth']).toBeFalsy();
  //     })
  //     .end((err) => {
  //       if (err) return done(err);
  //       return User.findById(initUsers[1]._id).then((user) => {
  //         expect(user.tokens.length).toBe(1);
  //         done();
  //       }).catch(e => done(e));
  //     });
  // });
});

describe('DELETE /user/me/token', () => {
  // it('should remove auth token on logout', (done) => {
  //   request(app)
  //     .delete('/user/me/token')
  //     .set('x-auth', initUsers[0].tokens[0].token)
  //     .expect(200)
  //     .end((err) => {
  //       if (err) return done(err);
  //       return User.findById(initUsers[0]._id).then((user) => {
  //         expect(user.tokens.length).toBe(0);
  //         done();
  //       }).catch(e => done(e));
  //     });
  // });
});
